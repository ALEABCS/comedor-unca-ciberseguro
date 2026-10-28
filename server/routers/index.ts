import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../db";
import { sessionStore } from "../db/session-store";
import { writeAudit } from "../db/audit";
import { createQrPayload, verifyQrPayload } from "../security/qr";
import { buildSecurityOverview } from "../security/security-center";
import { buildSecurityEventFeed } from "../security/event-bus";
import { consumeTicket, createReservation, cancelReservation, expireReservations, issueTicketForReservation } from "../domain/reservations";
import { createFoodCreditKey, isEligibleFoodCreditStudent } from "../domain/food-credits";
import { permissionProcedure, protectedProcedure, publicProcedure, router } from "../trpc";
import { roles, permissions, assignableRolesForActor, hasPermission, isCalendarDate, isInstitutionalBusinessDay, isTicketEligible, configuredDeadlineUtc, isWithinBookingWindow, startOfWeek } from "../../shared/domain";
import { config, featureFlags, isDemoMode, isGuestDemoMode } from "../config";
import { hashPassword } from "../auth/password";
import { cancelWaitlistEntry, joinWaitlist, promoteWaitlistForSlot } from "../domain/waitlist";
import { accessibilityPreferencesSchema, defaultAccessibilityPreferences } from "../../shared/accessibility";
import { canViewEventsNewsEntry } from "../../shared/events-news";
import { paymentMethodValues } from "../../shared/payment-methods";
import { splitFoodCatalogSearch } from "../../shared/food-catalog";
import {
  calculateCashClosure, comparePaymentAmounts, moneyCentsToDecimal,
  parseMoneyToCents, sumMoneyToCents
} from "../../shared/finance";
import type { Comida } from "../../shared/comidas";
import { planMenus } from "../../shared/menu-generator";

type Row = RowDataPacket & Record<string, unknown>;
type CapacityRow = RowDataPacket & {
  service: "ALMUERZO" | "CENA";
  capacity: number;
  booked: number;
  bookingEnabled: boolean | number;
  bookingOpensAt: string;
  bookingClosesAt: string;
  presentationDeadlineAt: string;
  closureReason: string | null;
};

const administratorLocalProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ADMINISTRADOR_LOCAL") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Solo el Administrador Local puede administrar las fotos del carrusel." });
  }
  return next({ ctx });
});
const contentManagerProcedure = administratorLocalProcedure.use(({ ctx, next }) => {
  if (ctx.user.isDemo) {
    throw new TRPCError({ code: "FORBIDDEN", message: "El entorno de demostración no puede modificar eventos ni publicaciones." });
  }
  return next({ ctx });
});

function requirePersonalReservationAccount(user: { isDemo: boolean; role: string }) {
  if (user.isDemo && user.role === "INVITADO_ESPECIAL") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Para reservar, registrate o ingresá con una cuenta personal." });
  }
}

const serviceSchema = z.enum(["ALMUERZO", "CENA"]);
const dateSchema = z.string().refine(isCalendarDate, "La fecha debe ser válida y usar el formato AAAA-MM-DD.");
const scholarshipSchema = z.enum(["BECA_COMPLETA", "MEDIA_BECA", "SIN_BECA"]);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "La hora debe usar HH:MM.");
const eventsNewsEntryShape = z.object({
  type: z.enum(["NOTICIA", "COMUNICADO", "EVENTO"]),
  visibility: z.enum(["PUBLICO", "PRIVADO"]),
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().min(3).max(5000),
  eventDate: dateSchema.nullable(),
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  location: z.string().trim().max(180).nullable(),
  eventStatus: z.enum(["PROGRAMADO", "REALIZADO", "CANCELADO"]),
  published: z.boolean()
});
function validateEventsNewsEntry(entry: z.infer<typeof eventsNewsEntryShape>, context: z.RefinementCtx) {
  if (entry.type !== "EVENTO") return;
  if (!entry.eventDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["eventDate"], message: "Indicá la fecha del evento." });
  if (!entry.startTime) context.addIssue({ code: z.ZodIssueCode.custom, path: ["startTime"], message: "Indicá el horario de inicio." });
  if (!entry.endTime) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "Indicá el horario de finalización." });
  if (!entry.location?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "Indicá el lugar del evento." });
  if (entry.startTime && entry.endTime && entry.endTime <= entry.startTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "La hora de finalización debe ser posterior al inicio." });
  }
}
const eventsNewsEntrySchema = eventsNewsEntryShape.superRefine(validateEventsNewsEntry);

function previousDate(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function normalizeFoodName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-AR")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function parseAllergenSnapshot(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return null;
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.map(String) : null;
}

function reportRange(period: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY", date?: string) {
  const anchor = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  if (period === "DAILY") return { from: anchor, to: nextDate(anchor) };
  if (period === "WEEKLY") {
    const from = startOfWeek(anchor);
    const end = new Date(`${from}T12:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    return { from, to: end.toISOString().slice(0, 10) };
  }
  if (period === "MONTHLY") {
    const from = `${anchor.slice(0, 7)}-01`;
    const month = new Date(`${from}T12:00:00.000Z`);
    month.setUTCMonth(month.getUTCMonth() + 1);
    return { from, to: month.toISOString().slice(0, 10) };
  }
  const from = `${anchor.slice(0, 4)}-01-01`;
  return { from, to: `${Number(anchor.slice(0, 4)) + 1}-01-01` };
}

type TurnRosterRow = {
  id: string;
  turnNumber: number | null;
  serviceDate: string;
  firstName: string;
  lastName: string;
};

async function loadTurnRoster(date: string, service: "ALMUERZO" | "CENA"): Promise<TurnRosterRow[]> {
  await expireReservations();
  const [rows] = await pool.execute<Row[]>(
    `SELECT r.id, COALESCE(t.daily_number, r.queue_number) AS turnNumber,
            r.service_date AS serviceDate, u.first_name AS firstName, u.last_name AS lastName
     FROM reservations r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN tickets t ON t.reservation_id = r.id
     WHERE r.service_date = ? AND r.service = ?
       AND r.status NOT IN ('CANCELADA', 'VENCIDA')
       AND r.approval_status <> 'RECHAZADA'
       AND r.payment_status IN ('PAGADO', 'NO_REQUIERE_PAGO')
     ORDER BY COALESCE(t.daily_number, r.queue_number) IS NULL,
              COALESCE(t.daily_number, r.queue_number), r.created_at, r.id`,
    [date, service]
  );
  return rows.map((row) => ({
    id: String(row.id),
    turnNumber: row.turnNumber == null ? null : Number(row.turnNumber),
    serviceDate: String(row.serviceDate).slice(0, 10),
    firstName: String(row.firstName),
    lastName: String(row.lastName)
  }));
}

export const appRouter = router({
  carousel: router({
    list: protectedProcedure.query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, caption FROM carousel_photos ORDER BY created_at, id`
      );
      return rows.map((row) => ({
        id: String(row.id),
        caption: String(row.caption)
      }));
    }),
    remove: administratorLocalProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT id FROM carousel_photos WHERE id = ? FOR UPDATE",
            [input.id]
          );
          if (!rows.length) {
            throw new TRPCError({ code: "NOT_FOUND", message: "La foto ya no está disponible en el carrusel." });
          }
          await connection.execute("DELETE FROM carousel_photos WHERE id = ?", [input.id]);
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "carousel.photo_removed",
            resourceType: "carousel_photo",
            resourceId: input.id
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  eventsNews: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const canViewPrivate = canViewEventsNewsEntry({
        role: ctx.user.role, isDemo: ctx.user.isDemo, twoFactorVerified: ctx.user.twoFactorVerified,
        published: true, visibility: "PRIVADO"
      });
      const canReviewDrafts = canViewEventsNewsEntry({
        role: ctx.user.role, isDemo: ctx.user.isDemo, twoFactorVerified: ctx.user.twoFactorVerified,
        published: false, visibility: "PRIVADO"
      });
      const [rows] = await pool.execute<Row[]>(
        `SELECT n.id, n.type, n.visibility, n.title, n.body,
                DATE_FORMAT(n.event_date, '%Y-%m-%d') AS eventDate,
                n.start_time AS startTime, n.end_time AS endTime, n.location,
                n.event_status AS eventStatus, n.published,
                DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
                GROUP_CONCAT(p.id ORDER BY p.created_at, p.id SEPARATOR ',') AS photoIds
         FROM events_news n
         LEFT JOIN events_news_photos p ON p.entry_id = n.id
         WHERE (n.published = 1 AND (n.visibility = 'PUBLICO' OR ? = 1))
            OR (? = 1 AND n.published = 0)
         GROUP BY n.id
         ORDER BY
           CASE WHEN n.type = 'EVENTO' AND n.event_date >= CURRENT_DATE
                     AND n.event_status = 'PROGRAMADO' THEN 0 ELSE 1 END,
           CASE WHEN n.type = 'EVENTO' AND n.event_date >= CURRENT_DATE
                     AND n.event_status = 'PROGRAMADO' THEN n.event_date END ASC,
           n.created_at DESC`,
        [canViewPrivate ? 1 : 0, canReviewDrafts ? 1 : 0]
      );
      return rows.map((row) => ({
        id: String(row.id),
        type: String(row.type) as "NOTICIA" | "COMUNICADO" | "EVENTO",
        visibility: String(row.visibility) as "PUBLICO" | "PRIVADO",
        title: String(row.title),
        body: String(row.body),
        eventDate: row.eventDate == null ? null : String(row.eventDate),
        startTime: row.startTime == null ? null : String(row.startTime),
        endTime: row.endTime == null ? null : String(row.endTime),
        location: row.location == null ? null : String(row.location),
        eventStatus: String(row.eventStatus) as "PROGRAMADO" | "REALIZADO" | "CANCELADO",
        published: Number(row.published) === 1,
        createdAt: String(row.createdAt),
        photoIds: row.photoIds == null ? [] : String(row.photoIds).split(",").filter(Boolean)
      }));
    }),
    create: contentManagerProcedure
      .input(eventsNewsEntrySchema)
      .mutation(async ({ ctx, input }) => {
        const id = randomUUID();
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            `INSERT INTO events_news
             (id, type, visibility, title, body, event_date, start_time, end_time, location,
              event_status, published, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, input.type, input.visibility, input.title, input.body, input.eventDate, input.startTime,
              input.endTime, input.location, input.eventStatus, input.published, ctx.user.id]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "events_news.created",
            resourceType: "events_news",
            resourceId: id,
            metadata: { type: input.type, visibility: input.visibility, published: input.published }
          });
          await connection.commit();
          return { id };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    update: contentManagerProcedure
        .input(eventsNewsEntryShape.extend({ id: z.string().uuid() }).superRefine(validateEventsNewsEntry))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT id FROM events_news WHERE id = ? FOR UPDATE",
            [input.id]
          );
          if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "La publicación ya no está disponible." });
          await connection.execute(
            `UPDATE events_news
             SET type = ?, title = ?, body = ?, event_date = ?, start_time = ?, end_time = ?,
                 location = ?, event_status = ?, visibility = ?, published = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [input.type, input.title, input.body, input.eventDate, input.startTime,
              input.endTime, input.location, input.eventStatus, input.visibility, input.published, input.id]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "events_news.updated",
            resourceType: "events_news",
            resourceId: input.id,
            metadata: { type: input.type, visibility: input.visibility, published: input.published }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    remove: contentManagerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT id, type FROM events_news WHERE id = ? FOR UPDATE",
            [input.id]
          );
          if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "La publicación ya no está disponible." });
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "events_news.removed",
            resourceType: "events_news",
            resourceId: input.id,
            metadata: { type: String(rows[0]?.type) }
          });
          await connection.execute("DELETE FROM events_news WHERE id = ?", [input.id]);
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    removePhoto: contentManagerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT id, entry_id AS entryId FROM events_news_photos WHERE id = ? FOR UPDATE",
            [input.id]
          );
          if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "La foto ya no está disponible." });
          await connection.execute("DELETE FROM events_news_photos WHERE id = ?", [input.id]);
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "events_news.photo_removed",
            resourceType: "events_news_photo",
            resourceId: input.id,
            metadata: { entryId: String(rows[0]?.entryId) }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  system: router({
    status: publicProcedure.query(() => ({
      name: "Comedor Universitario UNCA",
      demoMode: isDemoMode,
      guestDemoMode: isGuestDemoMode,
      googleLoginAvailable: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      featureFlags,
      version: "1.0.0"
    })),
    securityOverview: permissionProcedure("audit:read")
      .query(async () => {
        const [recentAuditRows] = await pool.execute<Row[]>(
          `SELECT COUNT(*) AS recentAuditEvents
           FROM audit_logs
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
        );
        const [failedLoginRows] = await pool.execute<Row[]>(
          `SELECT COUNT(*) AS failedLogins
           FROM audit_logs
           WHERE action IN ('login.failed', 'auth.login_failed', 'user.login_failed', 'MFA_LOGIN_FAILED')
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
        );
        const [revokedSessionRows] = await pool.execute<Row[]>(
          `SELECT COUNT(*) AS revokedSessions
           FROM audit_logs
           WHERE action IN ('session.revoke', 'session.revoke_others')
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
        );
        const [sessionRows] = await pool.execute<Row[]>(
          `SELECT COUNT(*) AS activeSessions
           FROM sessions
           WHERE expires > NOW()`
        );

        const overview = buildSecurityOverview({
          recentAuditEvents: Number(recentAuditRows[0]?.recentAuditEvents ?? 0),
          failedLogins: Number(failedLoginRows[0]?.failedLogins ?? 0),
          revokedSessions: Number(revokedSessionRows[0]?.revokedSessions ?? 0),
          activeSessions: Number(sessionRows[0]?.activeSessions ?? 0),
          featureFlags
        });

        return {
          ...overview,
          windowHours: 24,
          generatedAt: new Date().toISOString()
        };
      }),
    securityEvents: permissionProcedure("audit:read")
      .query(async () => {
        const [rows] = await pool.execute<Row[]>(
          `SELECT a.id, a.action, a.created_at AS createdAt, a.resource_type AS resourceType,
                  a.metadata,
                  u.email,
                  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.actorRole')), u.role) AS actorRole
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
           WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
           ORDER BY a.created_at DESC LIMIT 20`
        );
        return buildSecurityEventFeed(rows.map((row) => ({
          id: String(row.id),
          action: String(row.action ?? "system.event"),
          createdAt: String(row.createdAt ?? new Date().toISOString()),
          resourceType: row.resourceType ? String(row.resourceType) : null,
          metadata: row.metadata,
          email: row.email ? String(row.email) : null,
          actorRole: row.actorRole ? String(row.actorRole) : null
        })));
      }),
    securityAction: permissionProcedure("audit:read")
      .input(z.object({
        action: z.enum(["REQUEST_REAUTH", "REVOKE_SESSION", "CREATE_INCIDENT", "REQUEST_REVIEW"]),
        reason: z.string().trim().min(8).max(2000).optional(),
        severity: z.enum(["BAJA", "MEDIA", "ALTA", "CRITICA"]).default("MEDIA"),
        sessionId: z.string().trim().max(128).optional(),
        userId: z.string().trim().max(36).optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        const reason = input.reason?.trim() || "Se registró una acción de supervisión institucional del centro de seguridad.";
        try {
          await connection.beginTransaction();

          if (input.action === "REVOKE_SESSION" && input.sessionId) {
            const [result] = await connection.execute(
              `DELETE FROM sessions
               WHERE session_id = ?
                 AND (? = '' OR JSON_UNQUOTE(JSON_EXTRACT(data, '$.passport.user')) = ?)` ,
              [input.sessionId, input.userId ?? "", input.userId ?? ""]
            );
            const revoked = "affectedRows" in result ? Number(result.affectedRows) : 0;
            if (!revoked) {
              throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la sesión indicada para revocar." });
            }
          }

          if (input.action === "CREATE_INCIDENT" || input.action === "REQUEST_REVIEW") {
            const incidentId = randomUUID();
            const title = input.action === "CREATE_INCIDENT"
              ? "Incidente generado desde centro de seguridad"
              : "Revisión de seguridad solicitada por supervisión";
            await connection.execute(
              "INSERT INTO incidents (id, created_by, title, description, severity, status) VALUES (?, ?, ?, ?, ?, 'ABIERTO')",
              [incidentId, ctx.user.id, title, reason, input.severity]
            );
          }

          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: `security.action.${input.action.toLowerCase()}`,
            resourceType: "security_action",
            metadata: {
              actorRole: ctx.user.role,
              action: input.action,
              reason,
              sessionId: input.sessionId ?? null,
              userId: input.userId ?? null,
              severity: input.severity
            }
          });

          await connection.commit();
          return {
            success: true,
            action: input.action,
            message: input.action === "REQUEST_REAUTH"
              ? "Se solicitó la reautenticación del usuario y quedó registrada en auditoría."
              : input.action === "REVOKE_SESSION"
                ? "La sesión fue revocada y registrada con trazabilidad."
                : input.action === "CREATE_INCIDENT"
                  ? "Se creó un incidente abierto para revisión humana."
                  : "Se registró la solicitud de revisión y quedó pendiente de aprobación."
          };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    sessions: protectedProcedure.query(({ ctx }) =>
      sessionStore.listUserSessions(ctx.user.id, ctx.req.sessionID)
    ),
    revokeSession: protectedProcedure.input(z.object({ id: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
      if (input.id === ctx.req.sessionID) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Usá la opción de cerrar sesión para finalizar esta sesión." });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
          `DELETE FROM sessions
           WHERE session_id = ?
             AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.passport.user')) = ?`,
          [input.id, ctx.user.id]
        );
        if (!("affectedRows" in result) || !result.affectedRows) {
          throw new TRPCError({ code: "NOT_FOUND", message: "La sesión ya no está activa." });
        }
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "session.revoke", resourceType: "session",
          metadata: { actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    revokeOtherSessions: protectedProcedure.mutation(async ({ ctx }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
          `DELETE FROM sessions
           WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.passport.user')) = ?
             AND session_id <> ?`,
          [ctx.user.id, ctx.req.sessionID]
        );
        const count = "affectedRows" in result ? result.affectedRows : 0;
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "session.revoke_others", resourceType: "session",
          metadata: { revokedCount: count, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { revoked: count };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    permissions: protectedProcedure.query(({ ctx }) =>
      Object.keys(permissions).filter((permission) =>
        hasPermission(ctx.user.role, permission as keyof typeof permissions)
      )
    ),
    logout: protectedProcedure.mutation(({ ctx }) => new Promise<{ success: true }>((resolve, reject) => {
      ctx.req.logout((error) => {
        if (error) return reject(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo cerrar la sesión." }));
        ctx.req.session.cookie.maxAge = 0;
        ctx.req.session.destroy((sessionError) => {
          if (sessionError) return reject(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo invalidar la sesión." }));
          resolve({ success: true });
        });
      });
    }))
  }),
  reservations: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      await expireReservations();
      const [rows] = await pool.execute<Row[]>(
        `SELECT r.id, r.service_date AS serviceDate, r.service, r.status,
                r.queue_number AS queueNumber,
                r.approval_status AS approvalStatus, r.payment_status AS paymentStatus,
                r.price_amount AS priceAmount, r.price_currency AS priceCurrency, r.created_at AS createdAt,
                r.presentation_deadline AS presentationDeadline,
                c.presentation_deadline_at AS configuredPresentationDeadlineAt,
                c.booking_closes_at AS bookingClosesAt,
                t.id AS ticketId, t.daily_number AS ticketNumber, t.status AS ticketStatus
         FROM reservations r LEFT JOIN tickets t ON t.reservation_id = r.id
         LEFT JOIN service_capacity_config c ON c.service = r.service
         WHERE r.user_id = ? ORDER BY r.service_date DESC, r.service LIMIT 100`,
        [ctx.user.id]
      );
      return rows.map((row) => ({
        ...row,
        presentationDeadline: row.presentationDeadline ?? configuredDeadlineUtc(
          String(row.serviceDate).slice(0, 10),
          String(row.configuredPresentationDeadlineAt ?? "13:00")
        )
      })) as Row[];
    }),
    create: permissionProcedure("reservations:create")
      .input(z.object({ date: dateSchema, service: serviceSchema }))
      .mutation(({ ctx, input }) => {
        requirePersonalReservationAccount(ctx.user);
        return createReservation(ctx.user.id, input.date, input.service);
      }),
    createMany: permissionProcedure("reservations:create")
      .input(z.object({
        items: z.array(z.object({ date: dateSchema, service: serviceSchema })).min(1).max(5)
      }))
      .mutation(async ({ ctx, input }) => {
        requirePersonalReservationAccount(ctx.user);
        const unique = new Set(input.items.map((item) => `${item.date}:${item.service}`));
        if (unique.size !== input.items.length) throw new TRPCError({ code: "BAD_REQUEST", message: "La selección contiene servicios repetidos." });
        const results: Array<{
          date: string;
          service: string;
          success: boolean;
          message?: string;
          id?: string;
          status?: string;
          approvalStatus?: string;
          paymentStatus?: string;
        }> = [];
        for (const item of input.items) {
          try {
            const reservation = await createReservation(ctx.user.id, item.date, item.service);
            results.push({
              date: item.date,
              service: item.service,
              success: true,
              id: reservation.id,
              status: reservation.status,
              approvalStatus: reservation.approvalStatus,
              paymentStatus: reservation.paymentStatus
            });
          } catch (error) {
            if (!(error instanceof TRPCError)) {
              console.error(JSON.stringify({
                level: "ERROR",
                event: "reservation.create_many_item_failed",
                errorType: error instanceof Error ? error.name : "UnknownError"
              }));
            }
            results.push({
              date: item.date,
              service: item.service,
              success: false,
              message: error instanceof TRPCError ? error.message : "No se pudo procesar la reserva."
            });
          }
        }
        return results;
      }),
    cancel: permissionProcedure("reservations:cancel:own")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ ctx, input }) => cancelReservation(ctx.user.id, input.id)),
    waitlistMine: protectedProcedure.query(async ({ ctx }) => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT w.id, w.service_date AS serviceDate, w.service, w.status,
                w.created_at AS createdAt, w.offered_at AS offeredAt, w.expires_at AS expiresAt,
                CASE WHEN w.status = 'WAITING' THEN (
                  SELECT COUNT(*) + 1 FROM reservation_waitlist ahead
                  WHERE ahead.service_date = w.service_date AND ahead.service = w.service
                    AND ahead.status = 'WAITING'
                    AND (ahead.created_at < w.created_at OR (ahead.created_at = w.created_at AND ahead.id <= w.id))
                ) ELSE 0 END AS position
         FROM reservation_waitlist w
         WHERE w.user_id = ? AND w.status IN ('WAITING', 'OFFERED')
         ORDER BY w.created_at DESC LIMIT 20`,
        [ctx.user.id]
      );
      return rows;
    }),
    waitlistJoin: permissionProcedure("reservations:create")
      .input(z.object({ date: dateSchema, service: serviceSchema }))
      .mutation(({ ctx, input }) => {
        requirePersonalReservationAccount(ctx.user);
        return joinWaitlist(ctx.user.id, input.date, input.service);
      }),
    waitlistCancel: permissionProcedure("reservations:create")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ ctx, input }) => cancelWaitlistEntry(ctx.user.id, input.id)),
    waitlistConfirm: permissionProcedure("reservations:create")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        requirePersonalReservationAccount(ctx.user);
        const [rows] = await pool.execute<Row[]>(
          `SELECT service_date AS serviceDate, service FROM reservation_waitlist
           WHERE id = ? AND user_id = ? AND status = 'OFFERED' AND expires_at > UTC_TIMESTAMP()`,
          [input.id, ctx.user.id]
        );
        const offer = rows[0];
        if (!offer) throw new TRPCError({ code: "CONFLICT", message: "La oferta venció o ya no está disponible." });
        return createReservation(
          ctx.user.id,
          String(offer.serviceDate).slice(0, 10),
          offer.service as "ALMUERZO" | "CENA",
          input.id
        );
      }),
    reviewApproval: permissionProcedure("reservations:approve")
      .input(z.object({ id: z.string().uuid(), decision: z.enum(["APROBADA", "RECHAZADA"]) }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            `SELECT r.user_id AS userId, r.service_date AS serviceDate, r.service, r.status,
                    r.approval_status AS approvalStatus, r.payment_status AS paymentStatus
             FROM reservations r WHERE r.id = ? FOR UPDATE`,
            [input.id]
          );
          const reservation = rows[0];
          if (!reservation) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la reserva." });
          if (reservation.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "No podés revisar tu propia reserva." });
          if (reservation.approvalStatus !== "PENDIENTE" ||
              ["CANCELADA", "UTILIZADA", "VENCIDA"].includes(String(reservation.status))) {
            throw new TRPCError({ code: "CONFLICT", message: "La reserva ya no está pendiente de aprobación." });
          }
          if (input.decision === "RECHAZADA" && reservation.paymentStatus === "PAGADO") {
            throw new TRPCError({ code: "CONFLICT", message: "No se puede rechazar una reserva con pago aprobado." });
          }
          await connection.execute(
            `UPDATE reservations SET approval_status = ?, approval_actor_id = ?,
             approval_role_snapshot = ?, approval_updated_at = CURRENT_TIMESTAMP,
             status = IF(? = 'RECHAZADA', 'CANCELADA', status),
             cancelled_at = IF(? = 'RECHAZADA', CURRENT_TIMESTAMP, cancelled_at)
             WHERE id = ?`,
            [input.decision, ctx.user.id, ctx.user.role, input.decision, input.decision, input.id]
          );
          const ticketAvailable = isTicketEligible(input.decision, String(reservation.paymentStatus));
          if (ticketAvailable) await issueTicketForReservation(connection, input.id);
          if (input.decision === "RECHAZADA") {
            await connection.execute("UPDATE tickets SET status = 'CANCELADO' WHERE reservation_id = ?", [input.id]);
            await connection.execute(
              "UPDATE capacity_slots SET booked = GREATEST(booked - 1, 0) WHERE service_date = ? AND service = ?",
              [String(reservation.serviceDate).slice(0, 10), reservation.service]
            );
            await promoteWaitlistForSlot(
              connection, String(reservation.serviceDate).slice(0, 10), reservation.service as "ALMUERZO" | "CENA"
            );
            await connection.execute(
              `UPDATE payment_references SET status = 'RECHAZADO', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
               WHERE reservation_id = ? AND status = 'PENDIENTE'`,
              [ctx.user.id, input.id]
            );
          }
          const title = input.decision === "APROBADA" ? "Reserva aprobada" : "Reserva rechazada";
          const body = input.decision === "APROBADA"
            ? ticketAvailable
              ? "Tu reserva fue aprobada y tu ticket ya está disponible."
              : "Tu reserva fue aprobada. El ticket quedará disponible cuando se confirme el pago."
            : "Tu solicitud de reserva fue rechazada. El cupo quedó liberado.";
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
            [randomUUID(), reservation.userId, title, body]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id, action: `reservation.${input.decision.toLowerCase()}`,
            resourceType: "reservation", resourceId: input.id,
            metadata: {
              previousApprovalStatus: String(reservation.approvalStatus),
              newApprovalStatus: input.decision,
              actorRole: ctx.user.role
            }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    capacity: protectedProcedure
      .input(z.object({ date: dateSchema }))
      .query(async ({ input }) => {
        const [rows] = await pool.execute<CapacityRow[]>(
          `SELECT c.service, c.capacity, COALESCE(s.booked, 0) AS booked,
                  c.booking_enabled AS bookingEnabled, c.booking_opens_at AS bookingOpensAt,
                    c.booking_closes_at AS bookingClosesAt, c.presentation_deadline_at AS presentationDeadlineAt,
                    sc.reason AS closureReason
             FROM service_capacity_config c
             LEFT JOIN capacity_slots s ON s.service = c.service AND s.service_date = ?
             LEFT JOIN service_closures sc ON sc.service_date = ? AND sc.service = c.service
             ORDER BY c.service`,
            [input.date, input.date]
          );
        const now = new Intl.DateTimeFormat("en-GB", {
          timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).format(new Date());
        return rows.map((row) => {
          const businessDay = isInstitutionalBusinessDay(input.date);
          const bookingOpen = businessDay && !row.closureReason && Boolean(row.bookingEnabled) &&
            isWithinBookingWindow(now, String(row.bookingOpensAt), String(row.bookingClosesAt));
          const closingMinutes = Number(String(row.bookingClosesAt).slice(0, 2)) * 60 +
            Number(String(row.bookingClosesAt).slice(3, 5));
          const currentMinutes = Number(now.slice(0, 2)) * 60 + Number(now.slice(3, 5));
          return {
            service: row.service, capacity: Number(row.capacity), booked: Number(row.booked),
            bookingEnabled: Boolean(row.bookingEnabled), bookingOpensAt: row.bookingOpensAt,
            bookingClosesAt: row.bookingClosesAt, presentationDeadlineAt: row.presentationDeadlineAt,
            closureReason: row.closureReason, businessDay, bookingOpen, serverTime: now,
            minutesToClose: bookingOpen ? Math.max(0, closingMinutes - currentMinutes) : null
          };
        });
      }),
    ticketQr: protectedProcedure.input(z.object({ ticketId: z.string().uuid() })).query(async ({ ctx, input }) => {
      await expireReservations();
      const [rows] = await pool.execute<Row[]>(
        `SELECT t.id, t.status, r.user_id AS userId, r.status AS reservationStatus,
                r.approval_status AS approvalStatus, r.payment_status AS paymentStatus FROM tickets t
         JOIN reservations r ON r.id = t.reservation_id WHERE t.id = ?`,
        [input.ticketId]
      );
      if (!rows[0] || rows[0].userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos ese ticket." });
      if (rows[0].status !== "DISPONIBLE" || rows[0].reservationStatus !== "CONFIRMADA" ||
          !isTicketEligible(String(rows[0].approvalStatus), String(rows[0].paymentStatus))) {
        throw new TRPCError({ code: "CONFLICT", message: "El ticket no está habilitado para utilizarse." });
      }
      return { payload: createQrPayload(input.ticketId), status: rows[0].status };
    }),
    validateTicket: permissionProcedure("tickets:validate")
      .input(z.object({ payload: z.string().max(256) }))
      .mutation(async ({ ctx, input }) => {
        const id = verifyQrPayload(input.payload);
        if (!id) {
          await pool.execute(
            "INSERT INTO ticket_scans (id, operator_id, result) VALUES (?, ?, 'INVALID')",
            [randomUUID(), ctx.user.id]
          );
          throw new TRPCError({ code: "BAD_REQUEST", message: "El código QR no es válido." });
        }
        return consumeTicket(id, ctx.user.id);
      }),
    adminList: permissionProcedure("reservations:read:all")
      .input(z.object({
        date: dateSchema.optional(), service: serviceSchema.optional(),
        search: z.string().trim().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(50)
      }))
      .query(async ({ input }) => {
        await expireReservations();
        const search = input.search?.trim() ?? "";
        const [rows] = await pool.execute<Row[]>(
          `SELECT r.id, r.service_date AS serviceDate, r.service, r.status,
                    r.queue_number AS queueNumber,
                    r.approval_status AS approvalStatus, u.first_name AS firstName,
                    u.last_name AS lastName, u.email, u.dni, r.payment_status AS paymentStatus,
                    r.price_amount AS priceAmount, r.presentation_deadline AS presentationDeadline,
                    c.presentation_deadline_at AS configuredPresentationDeadlineAt,
                    t.id AS ticketId, t.daily_number AS ticketNumber, t.status AS ticketStatus
           FROM reservations r JOIN users u ON u.id = r.user_id
           LEFT JOIN tickets t ON t.reservation_id = r.id
           LEFT JOIN service_capacity_config c ON c.service = r.service
           WHERE (? IS NULL OR r.service_date = ?) AND (? IS NULL OR r.service = ?)
             AND (? = '' OR u.dni LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?
                  OR CAST(t.daily_number AS CHAR) LIKE ? OR t.id LIKE ?
                  OR CONCAT(t.daily_number, '-', DAY(r.service_date), '-', MONTH(r.service_date), '-',
                     YEAR(r.service_date), '-', IF(r.service = 'ALMUERZO', 'A', 'C')) LIKE ?)
           ORDER BY r.service_date DESC, r.service ASC, COALESCE(t.daily_number, r.queue_number) ASC, r.created_at ASC LIMIT ?`,
          [
            input.date ?? null, input.date ?? null, input.service ?? null, input.service ?? null,
            search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, input.limit
          ]
        );
        return rows.map((row) => ({
          ...row,
          presentationDeadline: row.presentationDeadline ?? configuredDeadlineUtc(
            String(row.serviceDate).slice(0, 10),
            String(row.configuredPresentationDeadlineAt ?? "13:00")
          )
        })) as Row[];
      }),
    turnRoster: permissionProcedure("reservations:read:all")
      .input(z.object({ date: dateSchema, service: serviceSchema }))
      .query(({ input }) => loadTurnRoster(input.date, input.service)),
    printTurnRoster: permissionProcedure("reservations:read:all")
      .input(z.object({ date: dateSchema, service: serviceSchema }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "ADMINISTRADOR_LOCAL") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo el Administrador Local puede imprimir la planilla de turnos." });
        }
        const turns = await loadTurnRoster(input.date, input.service);
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "reservation.print_turn_roster",
            resourceType: "reservation_roster",
            metadata: { serviceDate: input.date, service: input.service, reservationCount: turns.length }
          });
          await connection.commit();
          return { date: input.date, service: input.service, turns };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  foodCatalog: router({
    categories: permissionProcedure("menu:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        "SELECT code, label FROM food_categories WHERE active = 1 ORDER BY label"
      );
      return rows;
    }),
    allergens: permissionProcedure("menu:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        "SELECT code, label FROM food_allergens WHERE active = 1 ORDER BY label"
      );
      return rows;
    }),
    list: permissionProcedure("menu:manage")
      .input(z.object({
        search: z.string().trim().max(100).default(""),
        categoryCode: z.string().max(40).optional(),
        sinTacc: z.enum(["ALL", "YES", "NO", "UNKNOWN"]).default("ALL"),
        vegan: z.enum(["ALL", "YES", "NO", "UNKNOWN"]).default("ALL"),
        vegetarian: z.enum(["ALL", "YES", "NO", "UNKNOWN"]).default("ALL"),
        includeInactive: z.boolean().default(false),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20)
      }))
      .query(async ({ input }) => {
        const where = ["(? = 1 OR f.active = 1)"];
        const params: Array<string | number> = [input.includeInactive ? 1 : 0];
        const searchTerms = splitFoodCatalogSearch(input.search);
        if (searchTerms.length) {
          where.push(`(${searchTerms.map(() =>
            "(f.name LIKE ? OR f.subcategory LIKE ? OR f.description LIKE ? OR c.label LIKE ?)"
          ).join(" OR ")})`);
          for (const searchTerm of searchTerms) {
            const term = `%${searchTerm}%`;
            params.push(term, term, term, term);
          }
        }
        if (input.categoryCode) {
          where.push("f.category_code = ?");
          params.push(input.categoryCode);
        }
        for (const [column, filter] of [
          ["sin_tacc", input.sinTacc], ["vegan", input.vegan], ["vegetarian", input.vegetarian]
        ] as const) {
          if (filter === "YES") where.push(`f.${column} = 1`);
          if (filter === "NO") where.push(`f.${column} = 0`);
          if (filter === "UNKNOWN") where.push(`f.${column} IS NULL`);
        }
        const whereSql = where.join(" AND ");
        const [countRows] = await pool.execute<Row[]>(
          `SELECT COUNT(*) AS total FROM foods f
           JOIN food_categories c ON c.code = f.category_code
           WHERE ${whereSql}`, params
        );
        const offset = (input.page - 1) * input.pageSize;
        const [rows] = await pool.execute<Row[]>(
          `SELECT f.id, f.name, f.category_code AS categoryCode, c.label AS categoryLabel,
                  f.subcategory, f.food_type AS foodType, f.description, f.sin_tacc AS sinTacc,
                  f.vegan, f.vegetarian, f.allergens_verified AS allergensVerified,
                  f.calories, f.protein_grams AS proteinGrams,
                  f.carbohydrate_grams AS carbohydrateGrams, f.fat_grams AS fatGrams,
                  f.fiber_grams AS fiberGrams, f.sodium_milligrams AS sodiumMilligrams,
                  f.active, GROUP_CONCAT(DISTINCT al.allergen_code ORDER BY al.allergen_code SEPARATOR ',') AS allergenCodes
           FROM foods f JOIN food_categories c ON c.code = f.category_code
           LEFT JOIN food_allergen_links al ON al.food_id = f.id
           WHERE ${whereSql}
           GROUP BY f.id ORDER BY f.name, f.id LIMIT ? OFFSET ?`,
          [...params, input.pageSize, offset]
        );
        return {
          items: rows.map((row) => ({
            ...row,
            allergenCodes: typeof row.allergenCodes === "string" && row.allergenCodes
              ? row.allergenCodes.split(",") : []
          })) as Array<Row & { allergenCodes: string[] }>,
          total: Number(countRows[0]?.total ?? 0),
          page: input.page,
          pageSize: input.pageSize
        };
      }),
    create: permissionProcedure("menu:manage")
      .input(z.object({
        name: z.string().trim().min(2).max(160),
        categoryCode: z.string().min(1).max(40),
        subcategory: z.string().trim().max(80).nullable().optional(),
        foodType: z.enum(["ALIMENTO", "PREPARACION", "BEBIDA"]).default("ALIMENTO"),
        description: z.string().trim().max(2000).nullable().optional(),
        sinTacc: z.boolean().nullable().default(null),
        vegan: z.boolean().nullable().default(null),
        vegetarian: z.boolean().nullable().default(null),
        allergensVerified: z.boolean().default(false),
        allergenCodes: z.array(z.string().max(40)).max(100).default([]),
        calories: z.number().min(0).max(999999).nullable().default(null),
        proteinGrams: z.number().min(0).max(999999).nullable().default(null),
        carbohydrateGrams: z.number().min(0).max(999999).nullable().default(null),
        fatGrams: z.number().min(0).max(999999).nullable().default(null),
        fiberGrams: z.number().min(0).max(999999).nullable().default(null),
        sodiumMilligrams: z.number().min(0).max(999999).nullable().default(null)
      }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [categoryRows] = await connection.execute<Row[]>(
            "SELECT code FROM food_categories WHERE code = ? AND active = 1 FOR UPDATE",
            [input.categoryCode]
          );
          if (!categoryRows.length) throw new TRPCError({ code: "BAD_REQUEST", message: "La categoría seleccionada no está activa." });
          const allergenCodes = [...new Set(input.allergenCodes)];
          if (allergenCodes.length !== input.allergenCodes.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No repitas alérgenos en el mismo alimento." });
          }
          if (allergenCodes.length) {
            const [allergenRows] = await connection.execute<Row[]>(
              `SELECT code FROM food_allergens WHERE active = 1 AND code IN (${allergenCodes.map(() => "?").join(",")})`,
              allergenCodes
            );
            if (allergenRows.length !== allergenCodes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Uno o más alérgenos no están disponibles." });
          }
          const id = randomUUID();
          const normalizedName = normalizeFoodName(input.name);
          if (!normalizedName) throw new TRPCError({ code: "BAD_REQUEST", message: "El nombre debe contener letras o números." });
          await connection.execute(
            `INSERT INTO foods (id, name, normalized_name, category_code, subcategory, food_type, description,
             sin_tacc, vegan, vegetarian, allergens_verified, calories, protein_grams, carbohydrate_grams,
             fat_grams, fiber_grams, sodium_milligrams)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, input.name, normalizedName, input.categoryCode, input.subcategory ?? null, input.foodType,
              input.description ?? null, input.sinTacc, input.vegan, input.vegetarian, input.allergensVerified,
              input.calories, input.proteinGrams, input.carbohydrateGrams, input.fatGrams, input.fiberGrams,
              input.sodiumMilligrams]
          );
          for (const code of allergenCodes) {
            await connection.execute(
              "INSERT INTO food_allergen_links (food_id, allergen_code) VALUES (?, ?)", [id, code]
            );
          }
          await writeAudit(connection, {
            actorId: ctx.user.id, action: "food.create", resourceType: "food", resourceId: id,
            metadata: { categoryCode: input.categoryCode }
          });
          await connection.commit();
          return { id };
        } catch (error) {
          await connection.rollback();
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "CONFLICT", message: "Ya existe un alimento con ese nombre normalizado." });
          }
          throw error;
        } finally {
          connection.release();
        }
      }),
    update: permissionProcedure("menu:manage")
      .input(z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(2).max(160),
        categoryCode: z.string().min(1).max(40),
        subcategory: z.string().trim().max(80).nullable().optional(),
        foodType: z.enum(["ALIMENTO", "PREPARACION", "BEBIDA"]).default("ALIMENTO"),
        description: z.string().trim().max(2000).nullable().optional(),
        sinTacc: z.boolean().nullable().default(null),
        vegan: z.boolean().nullable().default(null),
        vegetarian: z.boolean().nullable().default(null),
        allergensVerified: z.boolean().default(false),
        allergenCodes: z.array(z.string().max(40)).max(100).default([]),
        calories: z.number().min(0).max(999999).nullable().default(null),
        proteinGrams: z.number().min(0).max(999999).nullable().default(null),
        carbohydrateGrams: z.number().min(0).max(999999).nullable().default(null),
        fatGrams: z.number().min(0).max(999999).nullable().default(null),
        fiberGrams: z.number().min(0).max(999999).nullable().default(null),
        sodiumMilligrams: z.number().min(0).max(999999).nullable().default(null)
      }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [categoryRows] = await connection.execute<Row[]>(
            "SELECT code FROM food_categories WHERE code = ? AND active = 1", [input.categoryCode]
          );
          if (!categoryRows.length) throw new TRPCError({ code: "BAD_REQUEST", message: "La categoría seleccionada no está activa." });
          const [foodRows] = await connection.execute<Row[]>(
            "SELECT id FROM foods WHERE id = ? FOR UPDATE", [input.id]
          );
          if (!foodRows.length) throw new TRPCError({ code: "NOT_FOUND", message: "No se encontró el alimento." });
          const allergenCodes = [...new Set(input.allergenCodes)];
          if (allergenCodes.length !== input.allergenCodes.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No repitas alérgenos en el mismo alimento." });
          }
          if (allergenCodes.length) {
            const [allergenRows] = await connection.execute<Row[]>(
              `SELECT code FROM food_allergens WHERE active = 1 AND code IN (${allergenCodes.map(() => "?").join(",")})`,
              allergenCodes
            );
            if (allergenRows.length !== allergenCodes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Uno o más alérgenos no están disponibles." });
          }
          const normalizedName = normalizeFoodName(input.name);
          if (!normalizedName) throw new TRPCError({ code: "BAD_REQUEST", message: "El nombre debe contener letras o números." });
          await connection.execute(
            `UPDATE foods SET name = ?, normalized_name = ?, category_code = ?, subcategory = ?, food_type = ?,
             description = ?, sin_tacc = ?, vegan = ?, vegetarian = ?, allergens_verified = ?, calories = ?,
             protein_grams = ?, carbohydrate_grams = ?, fat_grams = ?, fiber_grams = ?, sodium_milligrams = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [input.name, normalizedName, input.categoryCode, input.subcategory ?? null, input.foodType,
              input.description ?? null, input.sinTacc, input.vegan, input.vegetarian, input.allergensVerified,
              input.calories, input.proteinGrams, input.carbohydrateGrams, input.fatGrams, input.fiberGrams,
              input.sodiumMilligrams, input.id]
          );
          await connection.execute("DELETE FROM food_allergen_links WHERE food_id = ?", [input.id]);
          for (const code of allergenCodes) {
            await connection.execute("INSERT INTO food_allergen_links (food_id, allergen_code) VALUES (?, ?)", [input.id, code]);
          }
          await writeAudit(connection, {
            actorId: ctx.user.id, action: "food.update", resourceType: "food", resourceId: input.id,
            metadata: { categoryCode: input.categoryCode }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "CONFLICT", message: "Ya existe un alimento con ese nombre normalizado." });
          }
          throw error;
        } finally {
          connection.release();
        }
      }),
    setActive: permissionProcedure("menu:manage")
      .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT id FROM foods WHERE id = ? FOR UPDATE", [input.id]
          );
          if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "No se encontró el alimento." });
          await connection.execute(
            "UPDATE foods SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [input.active, input.id]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id, action: input.active ? "food.activate" : "food.deactivate",
            resourceType: "food", resourceId: input.id
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  menu: router({
    list: permissionProcedure("menu:read")
      .input(z.object({ from: dateSchema, to: dateSchema }))
      .query(async ({ ctx, input }) => {
        const showDrafts = hasPermission(ctx.user.role, "menu:manage");
        const [rows] = await pool.execute<Row[]>(
          `SELECT id, service_date AS serviceDate, service, title, description, ingredients,
                    main_dish AS mainDish, side_dish AS sideDish, salad, dessert, drink, bread,
                    nutritional_information AS nutritionalInformation, notes, published
           FROM menu_entries WHERE service_date >= ? AND service_date <= ? AND (? = 1 OR published = 1)
           ORDER BY service_date, service`,
          [input.from, input.to, showDrafts ? 1 : 0]
        );
        if (!rows.length) return rows as Array<Row & { items: Row[] }>;
        const ids = rows.map((row) => String(row.id));
        const [items] = await pool.execute<Row[]>(
          `SELECT id, menu_entry_id AS menuEntryId, food_id AS foodId,
                  food_name_snapshot AS foodName, component, sort_order AS sortOrder,
                  sin_tacc_snapshot AS sinTacc, vegan_snapshot AS vegan,
                  vegetarian_snapshot AS vegetarian,
                  allergens_verified_snapshot AS allergensVerified,
                  allergens_snapshot AS allergens
           FROM menu_entry_items
           WHERE menu_entry_id IN (${ids.map(() => "?").join(",")})
           ORDER BY menu_entry_id, component, sort_order, id`,
          ids
        );
        const itemsByMenu = new Map<string, Row[]>();
        for (const item of items) {
          const menuId = String(item.menuEntryId);
          const menuItems = itemsByMenu.get(menuId) ?? [];
          const allergens = parseAllergenSnapshot(item.allergens);
          menuItems.push({
            ...item,
            allergens,
            allergensVerified: Boolean(item.allergensVerified) && allergens !== null
          });
          itemsByMenu.set(menuId, menuItems);
        }
        return rows.map((row) => ({
          ...row, items: itemsByMenu.get(String(row.id)) ?? []
        })) as Array<Row & { items: Row[] }>;
      }),
    save: permissionProcedure("menu:manage")
      .input(z.object({
        id: z.string().uuid().optional(), date: dateSchema, service: serviceSchema,
        title: z.string().trim().min(3).max(180), description: z.string().trim().max(2000).optional(),
        ingredients: z.string().trim().max(2000).optional(),
        mainDish: z.string().trim().max(1000).optional(), sideDish: z.string().trim().max(1000).optional(),
        salad: z.string().trim().max(1000).optional(), dessert: z.string().trim().max(1000).optional(),
        drink: z.string().trim().max(1000).optional(), bread: z.string().trim().max(500).optional(),
        nutritionalInformation: z.string().trim().max(1000).optional(), notes: z.string().trim().max(1000).optional(),
        published: z.boolean(),
        items: z.array(z.object({
          foodId: z.string().uuid(),
          component: z.string().trim().min(1).max(80),
          sortOrder: z.number().int().min(0).max(1000)
        })).max(100).refine((items) => new Set(items.map((item) => item.foodId)).size === items.length, {
          message: "No repitas el mismo alimento en un menú."
        }).optional()
      }))
      .mutation(async ({ ctx, input }) => {
        let id = input.id;
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [existing] = await connection.execute<import("mysql2").RowDataPacket[]>(
            "SELECT id FROM menu_entries WHERE service_date = ? AND service = ? FOR UPDATE",
            [input.date, input.service]
          );
          id = existing[0] ? String(existing[0].id) : randomUUID();
          const menuItems: Array<{
            foodId: string;
            foodName: string;
            component: string;
            sortOrder: number;
            sinTacc: boolean | null;
            vegan: boolean | null;
            vegetarian: boolean | null;
            allergensVerified: boolean;
            allergens: string[];
          }> = [];
          if (input.items !== undefined && input.items.length) {
            const foodIds = [...new Set(input.items.map((item) => item.foodId))];
            const previousById = new Map<string, Row>();
            if (existing[0]) {
              const [previousItems] = await connection.execute<Row[]>(
                `SELECT food_id AS foodId, food_name_snapshot AS foodName,
                        sin_tacc_snapshot AS sinTacc, vegan_snapshot AS vegan,
                        vegetarian_snapshot AS vegetarian,
                        allergens_verified_snapshot AS allergensVerified,
                        allergens_snapshot AS allergens
                 FROM menu_entry_items
                 WHERE menu_entry_id = ? AND food_id IN (${foodIds.map(() => "?").join(",")})`,
                [id, ...foodIds]
              );
              for (const previous of previousItems) previousById.set(String(previous.foodId), previous);
            }
            const [foodRows] = await connection.execute<Row[]>(
              `SELECT f.id, f.name, f.sin_tacc AS sinTacc, f.vegan, f.vegetarian,
                      f.allergens_verified AS allergensVerified,
                      GROUP_CONCAT(DISTINCT al.allergen_code ORDER BY al.allergen_code SEPARATOR ',') AS allergenCodes
               FROM foods f LEFT JOIN food_allergen_links al ON al.food_id = f.id
               WHERE f.active = 1 AND f.id IN (${foodIds.map(() => "?").join(",")})
               GROUP BY f.id`,
              foodIds
            );
            const foodById = new Map(foodRows.map((food) => [String(food.id), food]));
            if (foodIds.some((foodId) => !foodById.has(foodId) && !previousById.has(foodId))) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Uno o más alimentos ya no están activos o no existen." });
            }
            for (const item of input.items) {
              const food = foodById.get(item.foodId);
              const previous = previousById.get(item.foodId);
              const allergens = food
                ? typeof food.allergenCodes === "string" && food.allergenCodes
                  ? food.allergenCodes.split(",") : []
                : Array.isArray(previous?.allergens)
                  ? previous.allergens.map(String)
                  : typeof previous?.allergens === "string" ? JSON.parse(previous.allergens) as string[] : [];
              menuItems.push({
                foodId: item.foodId,
                foodName: String(food?.name ?? previous?.foodName),
                component: item.component,
                sortOrder: item.sortOrder,
                sinTacc: food
                  ? food.sinTacc == null ? null : Boolean(food.sinTacc)
                  : previous?.sinTacc == null ? null : Boolean(previous?.sinTacc),
                vegan: food
                  ? food.vegan == null ? null : Boolean(food.vegan)
                  : previous?.vegan == null ? null : Boolean(previous?.vegan),
                vegetarian: food
                  ? food.vegetarian == null ? null : Boolean(food.vegetarian)
                  : previous?.vegetarian == null ? null : Boolean(previous?.vegetarian),
                allergensVerified: Boolean(food?.allergensVerified ?? previous?.allergensVerified),
                allergens
              });
            }
          }
          if (input.items === undefined && existing[0]) {
            const [savedItems] = await connection.execute<Row[]>(
              `SELECT food_id AS foodId, food_name_snapshot AS foodName, component,
                      sort_order AS sortOrder, sin_tacc_snapshot AS sinTacc,
                      vegan_snapshot AS vegan, vegetarian_snapshot AS vegetarian,
                      allergens_verified_snapshot AS allergensVerified,
                      allergens_snapshot AS allergens
               FROM menu_entry_items WHERE menu_entry_id = ?
               ORDER BY component, sort_order, id`,
              [id]
            );
            for (const saved of savedItems) {
              const allergens = Array.isArray(saved.allergens)
                ? saved.allergens.map(String)
                : typeof saved.allergens === "string" ? JSON.parse(saved.allergens) as string[] : [];
              menuItems.push({
                foodId: String(saved.foodId), foodName: String(saved.foodName),
                component: String(saved.component), sortOrder: Number(saved.sortOrder),
                sinTacc: saved.sinTacc === null ? null : Boolean(saved.sinTacc),
                vegan: saved.vegan === null ? null : Boolean(saved.vegan),
                vegetarian: saved.vegetarian === null ? null : Boolean(saved.vegetarian),
                allergensVerified: Boolean(saved.allergensVerified), allergens
              });
            }
          }
          const snapshot = JSON.stringify({
            date: input.date, service: input.service, title: input.title, description: input.description ?? "",
            ingredients: input.ingredients ?? "", nutritionalInformation: input.nutritionalInformation ?? "",
            mainDish: input.mainDish ?? "", sideDish: input.sideDish ?? "", salad: input.salad ?? "",
            dessert: input.dessert ?? "", drink: input.drink ?? "", bread: input.bread ?? "",
            notes: input.notes ?? "", published: input.published, items: menuItems
          });
          if (existing[0]) {
            await connection.execute(
              `UPDATE menu_entries SET title = ?, description = ?, ingredients = ?, main_dish = ?, side_dish = ?,
               salad = ?, dessert = ?, drink = ?, bread = ?, nutritional_information = ?, notes = ?,
               published = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [input.title, input.description ?? null, input.ingredients ?? null,
                input.mainDish ?? null, input.sideDish ?? null, input.salad ?? null, input.dessert ?? null,
                input.drink ?? null, input.bread ?? null, input.nutritionalInformation ?? null,
                input.notes ?? null, input.published, id]
            );
          } else {
            await connection.execute(
              `INSERT INTO menu_entries
               (id, service_date, service, title, description, ingredients, main_dish, side_dish, salad, dessert,
                drink, bread, nutritional_information, notes, published, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, input.date, input.service, input.title, input.description ?? null, input.ingredients ?? null,
                input.mainDish ?? null, input.sideDish ?? null, input.salad ?? null, input.dessert ?? null,
                input.drink ?? null, input.bread ?? null, input.nutritionalInformation ?? null,
                input.notes ?? null, input.published, ctx.user.id]
            );
          }
          if (input.items !== undefined) {
            await connection.execute("DELETE FROM menu_entry_items WHERE menu_entry_id = ?", [id]);
            for (const item of menuItems) {
              await connection.execute(
                `INSERT INTO menu_entry_items
                 (id, menu_entry_id, food_id, food_name_snapshot, component, sort_order,
                  sin_tacc_snapshot, vegan_snapshot, vegetarian_snapshot,
                  allergens_verified_snapshot, allergens_snapshot)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), id, item.foodId, item.foodName, item.component, item.sortOrder,
                  item.sinTacc, item.vegan, item.vegetarian, item.allergensVerified,
                  JSON.stringify(item.allergens)]
              );
            }
          }
          await connection.execute(
            "INSERT INTO menu_history (id, menu_entry_id, actor_id, action, snapshot) VALUES (?, ?, ?, ?, ?)",
            [randomUUID(), id, ctx.user.id, existing[0] ? "UPDATED" : "CREATED", snapshot]
          );
          await writeAudit(connection, { actorId: ctx.user.id, action: "menu.save", resourceType: "menu_entry", resourceId: id });
          await connection.commit();
          return { id };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  menuGenerator: router({
    settings: permissionProcedure("menu:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'menu_nutritional_percentage' LIMIT 1"
      );
      const configured = Number(rows[0]?.value ?? 80);
      return { nutritionalPercentage: Number.isInteger(configured) && configured >= 0 && configured <= 100 ? configured : 80 };
    }),
    setNutritionalPercentage: permissionProcedure("menu:manage")
      .input(z.object({ percentage: z.number().int().min(0).max(100) }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            `INSERT INTO app_settings (setting_key, setting_value, updated_by)
             VALUES ('menu_nutritional_percentage', ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
            [String(input.percentage), ctx.user.id]
          );
          await writeAudit(connection, { actorId: ctx.user.id, action: "menu_generator.percentage_update", resourceType: "app_setting", resourceId: "menu_nutritional_percentage", metadata: { percentage: input.percentage } });
          await connection.commit();
          return { nutritionalPercentage: input.percentage };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    generate: permissionProcedure("menu:manage")
      .input(z.object({ startDate: dateSchema, period: z.enum(["DAILY", "WEEKLY", "MONTHLY"]) }))
      .mutation(async ({ ctx, input }) => {
        const days = input.period === "DAILY" ? 1 : input.period === "WEEKLY" ? 7 : 30;
        const [settings] = await pool.execute<Row[]>(
          "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'menu_nutritional_percentage' LIMIT 1"
        );
        const configured = Number(settings[0]?.value ?? 80);
        const nutritionalPercentage = Number.isInteger(configured) && configured >= 0 && configured <= 100 ? configured : 80;
        const endDate = new Date(`${input.startDate}T12:00:00.000Z`);
        endDate.setUTCDate(endDate.getUTCDate() + days - 1);
        const guardStartDate = new Date(`${input.startDate}T12:00:00.000Z`);
        guardStartDate.setUTCDate(guardStartDate.getUTCDate() - 1);
        const guardEndDate = new Date(endDate);
        guardEndDate.setUTCDate(guardEndDate.getUTCDate() + 1);
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [existingRows] = await connection.execute<Row[]>(
            "SELECT service_date AS date, service, title FROM menu_entries WHERE service_date BETWEEN ? AND ? FOR UPDATE",
            [guardStartDate.toISOString().slice(0, 10), guardEndDate.toISOString().slice(0, 10)]
          );
          const [mealRows] = await connection.execute<Row[]>(
            `SELECT id, nombre AS name, normalized_name AS normalizedName, categoria AS category,
                    tipo_comida AS mealService, descripcion AS description, ingredientes AS ingredients,
                    preparacion AS preparation, porcion AS portion, calorias AS calories,
                    proteinas AS proteinGrams, carbohidratos AS carbohydrateGrams, grasas AS fatGrams,
                    fibra AS fiberGrams, sodio AS sodiumMilligrams, tiempo_preparacion AS preparationMinutes,
                    dificultad AS difficulty, costo_estimado AS estimatedCost, moneda AS currency,
                    apta_comedor AS suitableForCanteen, observaciones AS observations,
                    fuente_proteina AS proteinSource, metodo_coccion AS cookingMethod,
                    vegetariana AS vegetarian, contiene_carne AS containsMeat,
                    contiene_pescado AS containsFish, contiene_legumbres AS containsLegumes
             FROM comidas WHERE activa = 1 AND apta_comedor = 1 ORDER BY id`
          );
          const candidateMeals = mealRows.map((row) => ({
            ...row,
            id: String(row.id), name: String(row.name), normalizedName: String(row.normalizedName),
            category: String(row.category) as Comida["category"], mealService: String(row.mealService) as Comida["mealService"],
            description: String(row.description), ingredients: String(row.ingredients), preparation: String(row.preparation),
            portion: String(row.portion), calories: Number(row.calories), proteinGrams: Number(row.proteinGrams),
            carbohydrateGrams: Number(row.carbohydrateGrams), fatGrams: Number(row.fatGrams), fiberGrams: Number(row.fiberGrams),
            sodiumMilligrams: Number(row.sodiumMilligrams), preparationMinutes: Number(row.preparationMinutes),
            difficulty: String(row.difficulty) as Comida["difficulty"], estimatedCost: Number(row.estimatedCost),
            currency: String(row.currency) as "ARS", suitableForCanteen: Boolean(row.suitableForCanteen),
            observations: String(row.observations ?? ""), proteinSource: String(row.proteinSource) as Comida["proteinSource"],
            cookingMethod: String(row.cookingMethod) as Comida["cookingMethod"], vegetarian: Boolean(row.vegetarian),
            containsMeat: Boolean(row.containsMeat), containsFish: Boolean(row.containsFish), containsLegumes: Boolean(row.containsLegumes)
          })) as Comida[];
          const existingMealIds = candidateMeals.filter((meal) => existingRows.some((row) => String(row.title) === meal.name)).map((meal) => meal.id);
          const existingSlots = existingRows
            .filter((row) => String(row.date).slice(0, 10) >= input.startDate && String(row.date).slice(0, 10) <= endDate.toISOString().slice(0, 10))
            .map((row) => ({ date: String(row.date).slice(0, 10), service: String(row.service) }));
          const planned = planMenus(candidateMeals, input.startDate, days, nutritionalPercentage, existingSlots, existingMealIds);
          for (const slot of planned) {
            const id = randomUUID();
            const foodId = `00000000-0000-4000-8000-${slot.meal.id.padStart(12, "0")}`;
            const nutritionalInformation = `Energía ${slot.meal.calories} kcal · Proteínas ${slot.meal.proteinGrams} g · Carbohidratos ${slot.meal.carbohydrateGrams} g · Grasas ${slot.meal.fatGrams} g · Fibra ${slot.meal.fiberGrams} g · Sodio ${slot.meal.sodiumMilligrams} mg`;
            const snapshot = JSON.stringify({
              date: slot.date, service: slot.service, title: slot.meal.name, description: slot.meal.description,
              ingredients: slot.meal.ingredients, nutritionalInformation, mainDish: slot.meal.name,
              notes: `Generado automáticamente (${nutritionalPercentage}% nutricional). Revisar antes de publicar.`,
              published: false, items: [{ foodId, foodName: slot.meal.name, component: "Plato completo", sortOrder: 0 }]
            });
            await connection.execute(
              `INSERT INTO menu_entries
               (id, service_date, service, title, description, ingredients, main_dish,
                nutritional_information, notes, published, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
              [id, slot.date, slot.service, slot.meal.name, slot.meal.description, slot.meal.ingredients,
                slot.meal.name, nutritionalInformation,
                `Generado automáticamente (${nutritionalPercentage}% nutricional). Revisar antes de publicar.`, ctx.user.id]
            );
            await connection.execute(
              `INSERT INTO menu_entry_items
               (id, menu_entry_id, food_id, food_name_snapshot, component, sort_order,
                sin_tacc_snapshot, vegan_snapshot, vegetarian_snapshot, allergens_verified_snapshot, allergens_snapshot)
               VALUES (?, ?, ?, ?, 'Plato completo', 0, NULL, NULL, ?, FALSE, JSON_ARRAY())`,
              [randomUUID(), id, foodId, slot.meal.name, slot.meal.vegetarian]
            );
            await connection.execute(
              "INSERT INTO menu_history (id, menu_entry_id, actor_id, action, snapshot) VALUES (?, ?, ?, 'GENERATED', ?)",
              [randomUUID(), id, ctx.user.id, snapshot]
            );
          }
          if (planned.length) {
            await writeAudit(connection, {
              actorId: ctx.user.id, action: "menu.generate", resourceType: "menu_entry",
              resourceId: input.startDate, metadata: { period: input.period, generated: planned.length, nutritionalPercentage }
            });
          }
          await connection.commit();
          return { generated: planned.length, skipped: days * 2 - planned.length, nutritionalPercentage, endDate: endDate.toISOString().slice(0, 10) };
        } catch (error) {
          await connection.rollback();
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "CONFLICT", message: "Otro menú ya ocupa una de las fechas seleccionadas; no se modificaron menús existentes." });
          }
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  kitchen: router({
    board: permissionProcedure("kitchen:read")
      .input(z.object({ date: dateSchema }))
      .query(async ({ input }) => {
        const [rows] = await pool.execute<Row[]>(
          `SELECT services.service,
                  m.title AS menuTitle,
                  COALESCE(planned.portions, 0) AS plannedPortions,
                  COALESCE(consumed.portions, 0) AS consumedPortions,
                  COALESCE(p.produced_portions, 0) AS producedPortions,
                  p.notes, p.updated_at AS updatedAt
           FROM (
             SELECT 'ALMUERZO' AS service UNION ALL SELECT 'CENA'
           ) services
           LEFT JOIN menu_entries m ON m.service_date = ? AND m.service = services.service
           LEFT JOIN (
             SELECT service, COUNT(*) AS portions
             FROM reservations
             WHERE service_date = ? AND status IN ('CONFIRMADA', 'UTILIZADA', 'VENCIDA')
               AND approval_status = 'APROBADA'
               AND payment_status IN ('NO_REQUIERE_PAGO', 'PAGADO')
             GROUP BY service
           ) planned ON planned.service = services.service
           LEFT JOIN (
             SELECT service, COUNT(*) AS portions
             FROM tickets WHERE service_date = ? AND status = 'UTILIZADO'
             GROUP BY service
           ) consumed ON consumed.service = services.service
           LEFT JOIN kitchen_production p ON p.service_date = ? AND p.service = services.service
           ORDER BY FIELD(services.service, 'ALMUERZO', 'CENA')`,
          [input.date, input.date, input.date, input.date]
        );
        return rows.map((row) => ({
          service: String(row.service),
          menuTitle: row.menuTitle ? String(row.menuTitle) : null,
          plannedPortions: Number(row.plannedPortions),
          consumedPortions: Number(row.consumedPortions),
          producedPortions: Number(row.producedPortions),
          notes: row.notes ? String(row.notes) : "",
          updatedAt: row.updatedAt ?? null
        }));
      }),
    recordProduction: permissionProcedure("kitchen:manage")
      .input(z.object({
        date: dateSchema, service: serviceSchema,
        producedPortions: z.number().int().min(0).max(100000),
        notes: z.string().trim().max(2000).optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [previous] = await connection.execute<Row[]>(
            `SELECT produced_portions AS producedPortions, notes
             FROM kitchen_production WHERE service_date = ? AND service = ? FOR UPDATE`,
            [input.date, input.service]
          );
          const id = randomUUID();
          await connection.execute(
            `INSERT INTO kitchen_production
             (id, service_date, service, produced_portions, notes, updated_by)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE produced_portions = VALUES(produced_portions),
               notes = VALUES(notes), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
            [id, input.date, input.service, input.producedPortions, input.notes || null, ctx.user.id]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id, action: "kitchen.production_record", resourceType: "kitchen_production",
            metadata: {
              serviceDate: input.date,
              service: input.service,
              previousProduced: Number(previous[0]?.producedPortions ?? 0),
              producedPortions: input.producedPortions,
              actorRole: ctx.user.role
            }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  incidents: router({
    create: permissionProcedure("incidents:create")
      .input(z.object({
        title: z.string().trim().min(4).max(160), description: z.string().trim().min(10).max(5000),
        severity: z.enum(["BAJA", "MEDIA", "ALTA", "CRITICA"])
      }))
      .mutation(async ({ ctx, input }) => {
        const id = randomUUID();
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            "INSERT INTO incidents (id, created_by, title, description, severity) VALUES (?, ?, ?, ?, ?)",
            [id, ctx.user.id, input.title, input.description, input.severity]
          );
          await writeAudit(connection, { actorId: ctx.user.id, action: "incident.create", resourceType: "incident", resourceId: id });
          await connection.commit();
          return { id };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    list: permissionProcedure("incidents:read").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT i.id, i.title, i.description, i.severity, i.status, i.created_at AS createdAt,
                u.first_name AS firstName, u.last_name AS lastName
         FROM incidents i JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT 100`
      );
      return rows;
    }),
    updateStatus: permissionProcedure("incidents:manage")
      .input(z.object({
        id: z.string().uuid(), status: z.enum(["ABIERTO", "EN_INVESTIGACION", "RESUELTO", "CERRADO"]),
        resolution: z.string().trim().max(3000).optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT status FROM incidents WHERE id = ? FOR UPDATE",
            [input.id]
          );
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el incidente." });
          await connection.execute(
            "UPDATE incidents SET status = ?, resolution = ? WHERE id = ?",
            [input.status, input.resolution ?? null, input.id]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id, action: "incident.update", resourceType: "incident", resourceId: input.id,
            metadata: { previousStatus: String(rows[0].status), newStatus: input.status, actorRole: ctx.user.role }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      })
  }),
  scholarships: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, scholarship_type AS scholarshipType, status, valid_from AS validFrom,
                valid_until AS validUntil, created_at AS createdAt
         FROM scholarships WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
        [ctx.user.id]
      );
      return rows;
    }),
    request: protectedProcedure.input(z.object({
      type: z.enum(["BECA_COMPLETA", "MEDIA_BECA"]),
      documentationReference: z.string().trim().max(500).optional()
    })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "ALUMNO") throw new TRPCError({ code: "FORBIDDEN", message: "Solo estudiantes pueden solicitar una beca." });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [pending] = await connection.execute<Row[]>(
          "SELECT id FROM scholarships WHERE user_id = ? AND status = 'PENDIENTE' FOR UPDATE",
          [ctx.user.id]
        );
        if (pending.length) throw new TRPCError({ code: "CONFLICT", message: "Ya tenés una solicitud de beca pendiente." });
        const id = randomUUID();
        await connection.execute(
          `INSERT INTO scholarships (id, user_id, scholarship_type, documentation_reference, status)
           VALUES (?, ?, ?, ?, 'PENDIENTE')`,
          [id, ctx.user.id, input.type, input.documentationReference ?? null]
        );
        await connection.execute(
          "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
          [randomUUID(), ctx.user.id, "Presentación de documentación para beca", "Presentá los papeles y requisitos de tu solicitud en Mesa de Entrada de la Secretaría de Bienestar Universitaria - UNCA. El Supervisor gestionará la revisión."]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "scholarship.request", resourceType: "scholarship", resourceId: id,
          metadata: { scholarshipType: input.type, status: "PENDIENTE" }
        });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    list: permissionProcedure("scholarships:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT s.id, s.user_id AS userId, s.scholarship_type AS scholarshipType, s.status,
                s.valid_from AS validFrom, s.valid_until AS validUntil, s.created_at AS createdAt,
                u.first_name AS firstName, u.last_name AS lastName, u.dni
         FROM scholarships s JOIN users u ON u.id = s.user_id
         ORDER BY FIELD(s.status, 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'VENCIDA'), s.created_at LIMIT 200`
      );
      return rows;
    }),
    review: permissionProcedure("scholarships:manage").input(z.object({
      id: z.string().uuid(), status: z.enum(["APROBADA", "RECHAZADA"]),
      validFrom: dateSchema.optional(), validUntil: dateSchema.optional()
    })).mutation(async ({ ctx, input }) => {
      if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La vigencia hasta no puede ser anterior a la fecha de inicio." });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>("SELECT user_id AS userId, status FROM scholarships WHERE id = ? FOR UPDATE", [input.id]);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la solicitud de beca." });
        if (rows[0].status !== "PENDIENTE") throw new TRPCError({ code: "CONFLICT", message: "La solicitud ya fue revisada." });
        await connection.execute(
          `UPDATE scholarships SET status = ?, valid_from = ?, valid_until = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [input.status, input.status === "APROBADA" ? input.validFrom ?? null : null,
            input.status === "APROBADA" ? input.validUntil ?? null : null, ctx.user.id, input.id]
        );
        await connection.execute(
          "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
          [randomUUID(), String(rows[0].userId), input.status === "APROBADA" ? "Solicitud de beca aprobada" : "Solicitud de beca revisada", input.status === "APROBADA" ? "El Supervisor aprobó tu solicitud de beca. Consultá su vigencia en la sección Becas." : "El Supervisor revisó tu solicitud de beca. Consultá en la sección Becas o acercate a la Secretaría de Bienestar Universitaria - UNCA."]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "scholarship.review", resourceType: "scholarship", resourceId: input.id,
          metadata: { previousStatus: String(rows[0].status), newStatus: input.status, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  foodCredits: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "ALUMNO") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Los créditos de comida son un beneficio para estudiantes elegibles." });
      }
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, amount, reason, status, service_date AS serviceDate,
                reservation_id AS reservationId, created_at AS createdAt,
                reviewed_by AS reviewedBy, reviewed_at AS reviewedAt
         FROM food_credit_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
        [ctx.user.id]
      );
      return rows.map((row) => ({
        id: String(row.id),
        amount: Number(row.amount ?? 0),
        reason: row.reason == null ? null : String(row.reason),
        status: String(row.status),
        serviceDate: row.serviceDate == null ? null : String(row.serviceDate),
        reservationId: row.reservationId == null ? null : String(row.reservationId),
        createdAt: String(row.createdAt),
        reviewedBy: row.reviewedBy == null ? null : String(row.reviewedBy),
        reviewedAt: row.reviewedAt == null ? null : String(row.reviewedAt)
      }));
    }),
    list: permissionProcedure("scholarships:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT fcr.id, fcr.user_id AS userId, fcr.amount, fcr.reason, fcr.status,
                fcr.service_date AS serviceDate, fcr.reservation_id AS reservationId,
                fcr.created_at AS createdAt, u.first_name AS firstName, u.last_name AS lastName, u.dni
         FROM food_credit_requests fcr JOIN users u ON u.id = fcr.user_id
         ORDER BY FIELD(fcr.status, 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'UTILIZADA', 'VENCIDA'), fcr.created_at DESC
         LIMIT 200`
      );
      return rows;
    }),
    request: protectedProcedure.input(z.object({
      amount: z.number().int().min(1).max(2000),
      reason: z.string().trim().max(500).optional(),
      reservationId: z.string().uuid().optional(),
      serviceDate: dateSchema.optional()
    })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "ALUMNO") throw new TRPCError({ code: "FORBIDDEN", message: "Solo los estudiantes pueden solicitar créditos de comida." });

      const [scholarshipRows] = await pool.execute<Row[]>(
        `SELECT scholarship_type AS scholarshipType
         FROM scholarships
         WHERE user_id = ? AND status = 'APROBADA'
         ORDER BY valid_from DESC, created_at DESC LIMIT 1`,
        [ctx.user.id]
      );

      const scholarship = scholarshipRows[0] as Row | undefined;
      const scholarshipType = scholarship?.scholarshipType == null ? "SIN_BECA" : String(scholarship.scholarshipType);
      if (!isEligibleFoodCreditStudent(ctx.user.role, scholarshipType)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil no tiene crédito de comida habilitado." });
      }

      const serviceDate = input.serviceDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
      const creditKey = createFoodCreditKey(input.reservationId ?? ctx.user.id, serviceDate);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [existing] = await connection.execute<Row[]>(
          "SELECT id FROM food_credit_requests WHERE credit_key = ? FOR UPDATE",
          [creditKey]
        );
        if (existing.length) {
          throw new TRPCError({ code: "CONFLICT", message: "Ese crédito de comida ya fue registrado." });
        }

        const id = randomUUID();
        await connection.execute(
          `INSERT INTO food_credit_requests
           (id, user_id, reservation_id, service_date, amount, reason, credit_key, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')`,
          [id, ctx.user.id, input.reservationId ?? null, serviceDate, input.amount, input.reason ?? null, creditKey]
        );

        await connection.execute(
          "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
          [randomUUID(), ctx.user.id, "Solicitud de crédito de comida", "Tu solicitud de crédito de comida quedó pendiente de revisión por el Supervisor. Serás notificado cuando se resuelva."]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id,
          action: "food_credit.request",
          resourceType: "food_credit_request",
          resourceId: id,
          metadata: { amount: input.amount, scholarshipType, creditKey }
        });
        await connection.commit();
        return { id, status: "PENDIENTE" };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    review: permissionProcedure("scholarships:manage").input(z.object({
      id: z.string().uuid(),
      status: z.enum(["APROBADA", "RECHAZADA"]),
      note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          "SELECT user_id AS userId, amount, status FROM food_credit_requests WHERE id = ? FOR UPDATE",
          [input.id]
        );
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la solicitud de crédito de comida." });
        if (rows[0].status !== "PENDIENTE") throw new TRPCError({ code: "CONFLICT", message: "La solicitud ya fue revisada." });

        await connection.execute(
          `UPDATE food_credit_requests
           SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [input.status, ctx.user.id, input.id]
        );
        await connection.execute(
          `INSERT INTO food_credit_movements (id, user_id, request_id, entry_type, amount, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), String(rows[0].userId), input.id, input.status, Number(rows[0].amount ?? 0), input.note ?? null]
        );
        await connection.execute(
          "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
          [randomUUID(), String(rows[0].userId), input.status === "APROBADA" ? "Crédito de comida aprobado" : "Crédito de comida revisado", input.status === "APROBADA" ? "Se aprobó tu solicitud de crédito de comida. El importe quedó disponible para ser utilizado en el comedor." : "El Supervisor revisó tu solicitud de crédito de comida. Consultá el detalle en la sección Créditos de comida."]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id,
          action: "food_credit.review",
          resourceType: "food_credit_request",
          resourceId: input.id,
          metadata: { previousStatus: String(rows[0].status), newStatus: input.status, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  benefits: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, name, description, status, valid_from AS validFrom,
                valid_until AS validUntil, created_at AS createdAt
         FROM benefits WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
        [ctx.user.id]
      );
      return rows;
    }),
    list: permissionProcedure("scholarships:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT b.id, b.user_id AS userId, b.name, b.description, b.status,
                b.valid_from AS validFrom, b.valid_until AS validUntil,
                b.approved_by AS approvedBy, b.created_at AS createdAt,
                u.first_name AS firstName, u.last_name AS lastName, u.dni
         FROM benefits b JOIN users u ON u.id = b.user_id
         ORDER BY FIELD(b.status, 'PENDIENTE', 'APROBADO', 'RECHAZADO', 'VENCIDO'), b.created_at DESC
         LIMIT 200`
      );
      return rows;
    }),
    assign: permissionProcedure("scholarships:manage").input(z.object({
      userId: z.string().uuid(),
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(2000).optional(),
      validFrom: dateSchema.optional(),
      validUntil: dateSchema.optional()
    })).mutation(async ({ ctx, input }) => {
      if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La vigencia hasta no puede ser anterior a la fecha de inicio." });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [users] = await connection.execute<Row[]>(
          "SELECT id FROM users WHERE id = ? AND status = 'ACTIVE' FOR UPDATE",
          [input.userId]
        );
        if (!users[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos una cuenta activa para asignar el beneficio." });
        const id = randomUUID();
        await connection.execute(
          `INSERT INTO benefits (id, user_id, name, description, status, valid_from, valid_until, approved_by)
           VALUES (?, ?, ?, ?, 'APROBADO', ?, ?, ?)`,
          [id, input.userId, input.name, input.description ?? null, input.validFrom ?? null, input.validUntil ?? null, ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "benefit.assign", resourceType: "benefit", resourceId: id,
          metadata: { name: input.name, status: "APROBADO", actorRole: ctx.user.role }
        });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    setStatus: permissionProcedure("scholarships:manage").input(z.object({
      id: z.string().uuid(), status: z.enum(["APROBADO", "RECHAZADO", "VENCIDO"])
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          "SELECT status FROM benefits WHERE id = ? FOR UPDATE",
          [input.id]
        );
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el beneficio." });
        await connection.execute(
          `UPDATE benefits SET status = ?, approved_by = IF(? = 'APROBADO', ?, approved_by) WHERE id = ?`,
          [input.status, input.status, ctx.user.id, input.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "benefit.status_change", resourceType: "benefit", resourceId: input.id,
          metadata: {
            previousStatus: String(rows[0].status), newStatus: input.status, actorRole: ctx.user.role
          }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  payments: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT p.id, p.reservation_id AS reservationId, p.provider, p.method,
                p.provider_reference AS reference,
          p.proof_image IS NOT NULL AS hasProof,
                p.amount, p.currency, p.status, p.created_at AS createdAt,
                r.service_date AS serviceDate, r.service
         FROM payment_references p
         LEFT JOIN reservations r ON r.id = p.reservation_id
         WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 100`,
        [ctx.user.id]
      );
      if (!rows.length) return rows;
      const paymentIds = rows.map((payment) => String(payment.id));
      const placeholders = paymentIds.map(() => "?").join(", ");
      const [associations] = await pool.execute<Row[]>(
        `SELECT payment_reference_id AS paymentReferenceId, reservation_id AS reservationId
         FROM payment_reference_reservations WHERE payment_reference_id IN (${placeholders})`,
        paymentIds
      );
      const reservationIdsByPayment = new Map<string, string[]>();
      for (const association of associations) {
        const paymentId = String(association.paymentReferenceId);
        reservationIdsByPayment.set(paymentId, [...(reservationIdsByPayment.get(paymentId) ?? []), String(association.reservationId)]);
      }
      return rows.map((payment) => {
        const reservationIds = reservationIdsByPayment.get(String(payment.id)) ?? (payment.reservationId ? [String(payment.reservationId)] : []);
        return { ...payment, reservationIds: reservationIds.join(","), reservationCount: reservationIds.length };
      }) as Row[];
    }),
    pendingReservations: permissionProcedure("payments:read").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT r.id AS reservationId, r.user_id AS userId, u.first_name AS firstName,
                u.last_name AS lastName, u.email, r.role_snapshot AS role,
                r.scholarship_type AS scholarshipType, r.service_date AS serviceDate,
                r.service, r.price_amount AS amount, r.price_currency AS currency,
                r.payment_status AS paymentStatus
         FROM reservations r
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'PENDIENTE' AND r.payment_status IN ('PENDIENTE', 'RECHAZADO')
           AND r.approval_status <> 'RECHAZADA' AND r.price_amount > 0
         ORDER BY r.service_date ASC, r.created_at ASC LIMIT 200`
      );
      return rows;
    }),
    submitReference: protectedProcedure.input(z.object({
      reservationId: z.string().uuid(),
      method: z.enum(paymentMethodValues),
      reference: z.string().trim().min(3).max(191).regex(/^[\p{L}\p{N}._/-]+$/u, "La referencia contiene caracteres no válidos.")
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT id, price_amount AS amount, price_currency AS currency, payment_status AS paymentStatus, status
           FROM reservations WHERE id = ? AND user_id = ? FOR UPDATE`,
          [input.reservationId, ctx.user.id]
        );
        const reservation = rows[0];
        if (!reservation) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos esa reserva." });
        if (reservation.status !== "PENDIENTE" || Number(reservation.amount) <= 0 ||
            !["PENDIENTE", "RECHAZADO"].includes(String(reservation.paymentStatus))) {
          throw new TRPCError({ code: "CONFLICT", message: "La reserva no admite referencias de pago en su estado actual." });
        }
        const [existing] = await connection.execute<Row[]>(
          "SELECT id, status FROM payment_references WHERE reservation_id = ? FOR UPDATE",
          [input.reservationId]
        );
        const [linkedExisting] = await connection.execute<Row[]>(
          `SELECT p.id, p.status FROM payment_reference_reservations pr
           JOIN payment_references p ON p.id = pr.payment_reference_id
           WHERE pr.reservation_id = ? FOR UPDATE`,
          [input.reservationId]
        );
        if ((existing[0] && existing[0].status !== "RECHAZADO") || linkedExisting.some((payment) => payment.status !== "RECHAZADO")) {
          throw new TRPCError({ code: "CONFLICT", message: "Ya se presentó una referencia para esta reserva." });
        }
        const id = existing[0] ? String(existing[0].id) : randomUUID();
        if (existing[0]) {
          await connection.execute(
            `UPDATE payment_references SET provider_reference = ?, method = ?, proof_mime_type = NULL, proof_image = NULL,
             amount = ?, currency = ?, status = 'PENDIENTE',
             reviewed_by = NULL, reviewed_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [input.reference, input.method, reservation.amount, reservation.currency, id]
          );
          await connection.execute("DELETE FROM payment_reference_reservations WHERE payment_reference_id = ?", [id]);
        } else {
          await connection.execute(
            `INSERT INTO payment_references
             (id, user_id, reservation_id, provider, provider_reference, method, amount, currency, status)
             VALUES (?, ?, ?, 'REFERENCIA_MANUAL', ?, ?, ?, ?, 'PENDIENTE')`,
            [id, ctx.user.id, input.reservationId, input.reference, input.method, reservation.amount, reservation.currency]
          );
        }
        await connection.execute(
          "INSERT INTO payment_reference_reservations (payment_reference_id, reservation_id) VALUES (?, ?)",
          [id, input.reservationId]
        );
        await connection.execute("UPDATE reservations SET payment_status = 'PENDIENTE' WHERE id = ?", [input.reservationId]);
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, reference, actor_id)
           VALUES (?, ?, 'COMPROBANTE_PRESENTADO', ?, ?, ?, ?)`,
          [randomUUID(), id, String(reservation.amount), String(reservation.currency), input.reference, ctx.user.id]
        );
        await writeAudit(connection, { actorId: ctx.user.id, action: "payment.reference_submit", resourceType: "payment_reference", resourceId: id });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    list: permissionProcedure("payments:read").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT p.id, p.user_id AS userId, p.reservation_id AS reservationId, p.provider, p.method,
          p.provider_reference AS reference, p.proof_image IS NOT NULL AS hasProof,
          (SELECT COUNT(*) FROM payment_reference_reservations pr WHERE pr.payment_reference_id = p.id) AS reservationCount,
          p.amount, p.currency, p.status, p.reviewed_by AS reviewedBy, p.reviewed_at AS reviewedAt,
          (SELECT event_type FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
           ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1) AS latestFinanceEvent,
                p.created_at AS createdAt,
                u.first_name AS firstName, u.last_name AS lastName, u.email,
                r.service_date AS serviceDate, r.service
         FROM payment_references p JOIN users u ON u.id = p.user_id
         LEFT JOIN reservations r ON r.id = p.reservation_id
         ORDER BY FIELD(p.status, 'PENDIENTE', 'APROBADO', 'RECHAZADO', 'REEMBOLSADO'), p.created_at DESC LIMIT 200`
      );
      return rows;
    }),
    verifyDocumentation: permissionProcedure("payments:manage").input(z.object({
      id: z.string().uuid(), note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT amount, currency, provider_reference AS reference, status
           FROM payment_references WHERE id = ? FOR UPDATE`,
          [input.id]
        );
        const payment = rows[0];
        if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la referencia de pago." });
        if (payment.status !== "PENDIENTE") throw new TRPCError({ code: "CONFLICT", message: "La referencia ya no está pendiente." });
        const [events] = await connection.execute<Row[]>(
          `SELECT event_type AS eventType FROM payment_finance_events
           WHERE payment_reference_id = ? ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [input.id]
        );
        if (events[0]?.eventType === "DOCUMENTACION_VERIFICADA") {
          throw new TRPCError({ code: "CONFLICT", message: "La documentación ya fue verificada." });
        }
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
           VALUES (?, ?, 'DOCUMENTACION_VERIFICADA', ?, ?, ?, ?, ?)`,
          [randomUUID(), input.id, String(payment.amount), String(payment.currency), String(payment.reference), input.note ?? null, ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "payment.documentation_verified", resourceType: "payment_reference", resourceId: input.id,
          metadata: { declaredAmount: String(payment.amount), currency: String(payment.currency) }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    review: permissionProcedure("payments:manage").input(z.object({
      id: z.string().uuid(), status: z.enum(["APROBADO", "RECHAZADO"]),
      accreditedAmount: z.string().trim().max(20).optional(),
      institutionalReference: z.string().trim().min(3).max(191).optional(),
      note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT user_id AS userId, reservation_id AS reservationId, provider_reference AS reference,
                  amount, currency, status FROM payment_references WHERE id = ? FOR UPDATE`,
          [input.id]
        );
        const payment = rows[0];
        if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la referencia de pago." });
        if (payment.status !== "PENDIENTE") throw new TRPCError({ code: "CONFLICT", message: "La referencia ya fue revisada." });
        if (input.status === "APROBADO" && !hasPermission(ctx.user.role, "payments:reconcile")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo el Supervisor puede confirmar la acreditación financiera." });
        }
        if (input.status === "APROBADO" && (!input.accreditedAmount || !input.institutionalReference)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Registrá el importe acreditado y la referencia institucional." });
        }
        if (input.status === "APROBADO") {
          const [events] = await connection.execute<Row[]>(
            `SELECT event_type AS eventType FROM payment_finance_events
             WHERE payment_reference_id = ? ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
            [input.id]
          );
          if (events[0]?.eventType !== "DOCUMENTACION_VERIFICADA") {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Primero verificá la documentación presentada." });
          }
        }
        const [reservations] = await connection.execute<Row[]>(
          `SELECT r.id, r.user_id AS userId, r.price_amount AS priceAmount, r.price_currency AS priceCurrency,
                  r.status, r.approval_status AS approvalStatus FROM reservations r
           WHERE r.id IN (
             SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = ?
             UNION SELECT reservation_id FROM payment_references WHERE id = ? AND reservation_id IS NOT NULL
           ) ORDER BY r.id FOR UPDATE`,
          [input.id, input.id]
        );
        if (!reservations.length || reservations.some((reservation) =>
          reservation.status !== "PENDIENTE" || String(reservation.userId) !== String(payment.userId) ||
          String(reservation.priceCurrency) !== String(payment.currency)
        )) {
          throw new TRPCError({ code: "CONFLICT", message: "Una o más reservas ya no están pendientes de pago." });
        }
        if (input.status === "APROBADO") {
          const expectedCents = sumMoneyToCents(reservations.map((reservation) => String(reservation.priceAmount)));
          const declaredCents = parseMoneyToCents(String(payment.amount));
          const accreditedCents = parseMoneyToCents(input.accreditedAmount!);
          if (expectedCents === null || declaredCents === null || accreditedCents === null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No se pudo validar el importe acreditado." });
          }
          const reconciliation = comparePaymentAmounts(expectedCents, declaredCents, accreditedCents);
          if (!reconciliation) throw new TRPCError({ code: "BAD_REQUEST", message: "No se pudo comparar los importes." });
          if (!reconciliation.matches) {
            const difference = reconciliation.differenceCents;
            const differenceNote = `Esperado ${moneyCentsToDecimal(expectedCents)} ${String(payment.currency)}; declarado ${moneyCentsToDecimal(declaredCents)} ${String(payment.currency)}; acreditado ${moneyCentsToDecimal(accreditedCents)} ${String(payment.currency)}.${input.note ? ` ${input.note}` : ""}`;
            await connection.execute(
              `INSERT INTO payment_finance_events
               (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
               VALUES (?, ?, 'DIFERENCIA_DETECTADA', ?, ?, ?, ?, ?)`,
              [randomUUID(), input.id, moneyCentsToDecimal(accreditedCents), String(payment.currency), input.institutionalReference!, differenceNote, ctx.user.id]
            );
            await writeAudit(connection, {
              actorId: ctx.user.id, action: "payment.accreditation_difference", resourceType: "payment_reference", resourceId: input.id,
              metadata: { expectedCents, declaredCents, accreditedCents, differenceCents: difference, actorRole: ctx.user.role }
            });
            await connection.commit();
            return { success: true, status: "OBSERVADO" as const };
          }
          const [allocations] = await connection.execute<Row[]>(
            "SELECT id FROM payment_allocations WHERE payment_reference_id = ? LIMIT 1 FOR UPDATE",
            [input.id]
          );
          if (allocations.length) throw new TRPCError({ code: "CONFLICT", message: "El pago ya tiene imputaciones registradas." });
          await connection.execute(
            `INSERT INTO payment_finance_events
             (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
             VALUES (?, ?, 'ACREDITACION_CONFIRMADA', ?, ?, ?, ?, ?)`,
            [randomUUID(), input.id, moneyCentsToDecimal(accreditedCents), String(payment.currency), input.institutionalReference!, input.note ?? null, ctx.user.id]
          );
          for (const reservation of reservations) {
            await connection.execute(
              `INSERT INTO payment_allocations
               (id, payment_reference_id, reservation_id, amount, currency, allocated_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [randomUUID(), input.id, String(reservation.id), String(reservation.priceAmount), String(reservation.priceCurrency), ctx.user.id]
            );
          }
        } else {
          await connection.execute(
            `INSERT INTO payment_finance_events
             (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
             VALUES (?, ?, 'DOCUMENTACION_RECHAZADA', ?, ?, ?, ?, ?)`,
            [randomUUID(), input.id, String(payment.amount), String(payment.currency), String(payment.reference), input.note ?? null, ctx.user.id]
          );
        }
        await connection.execute(
          "UPDATE payment_references SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
          [input.status, ctx.user.id, input.id]
        );
        const reservationIds = reservations.map((reservation) => String(reservation.id));
        const reservationPlaceholders = reservationIds.map(() => "?").join(", ");
        await connection.execute(
          `UPDATE reservations SET payment_status = ?, status = ?,
           approval_status = IF(? = 'APROBADO', 'APROBADA', approval_status),
           approval_actor_id = IF(? = 'APROBADO', ?, approval_actor_id),
           approval_role_snapshot = IF(? = 'APROBADO', ?, approval_role_snapshot),
           approval_updated_at = IF(? = 'APROBADO', CURRENT_TIMESTAMP, approval_updated_at)
           WHERE id IN (${reservationPlaceholders}) AND status = 'PENDIENTE'`,
          [input.status === "APROBADO" ? "PAGADO" : "RECHAZADO",
            input.status === "APROBADO" ? "CONFIRMADA" : "PENDIENTE",
            input.status, input.status, ctx.user.id, input.status, ctx.user.role, input.status, ...reservationIds]
        );
        if (input.status === "APROBADO") {
          for (const reservation of reservations) {
            if (reservation.approvalStatus !== "APROBADA") {
              await writeAudit(connection, {
                actorId: ctx.user.id, action: "reservation.approved_by_payment",
                resourceType: "reservation", resourceId: String(reservation.id),
                metadata: { paymentReferenceId: input.id, actorRole: ctx.user.role }
              });
            }
            const ticket = await issueTicketForReservation(connection, String(reservation.id));
            await connection.execute(
              "INSERT INTO notifications (id, user_id, title, body) SELECT ?, user_id, ?, ? FROM reservations WHERE id = ?",
              [randomUUID(), "Turno confirmado", `Tu pago y reserva fueron aprobados. Tu turno es el ${ticket.ticketNumber} y el ticket ya está disponible.`, reservation.id]
            );
          }
        }
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "payment.review", resourceType: "payment_reference", resourceId: input.id,
          metadata: { previousStatus: String(payment.status), newStatus: input.status, actorRole: ctx.user.role, reservationCount: reservationIds.length }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  finance: router({
    transactions: permissionProcedure("payments:read").input(z.object({
      dateFrom: dateSchema.optional(),
      dateTo: dateSchema.optional(),
      service: serviceSchema.optional(),
      person: z.string().trim().max(254).optional(),
      paymentId: z.string().trim().max(191).optional(),
      reservationId: z.string().uuid().optional(),
      method: z.enum([...paymentMethodValues, "EFECTIVO"]).optional(),
      paymentStatus: z.enum(["PENDIENTE", "APROBADO", "RECHAZADO", "REEMBOLSADO"]).optional(),
      financialStatus: z.enum(["SIN_EVENTO", "PENDIENTE", "ACREDITADO", "DIFERENCIA"]).optional(),
      reviewerId: z.string().uuid().optional(),
      cashShiftId: z.string().uuid().optional(),
      amountFrom: z.string().trim().max(20).optional(),
      amountTo: z.string().trim().max(20).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(50)
    }).refine((input) => !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, {
      message: "El intervalo de fechas no es válido."
    })).query(async ({ input }) => {
      const conditions: string[] = [];
      const values: Array<string | number> = [];
      const latestEvent = `(SELECT event_type FROM payment_finance_events fe
        WHERE fe.payment_reference_id = p.id ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1)`;
      if (input.dateFrom) { conditions.push("DATE(p.created_at) >= ?"); values.push(input.dateFrom); }
      if (input.dateTo) { conditions.push("DATE(p.created_at) <= ?"); values.push(input.dateTo); }
      if (input.service) {
        conditions.push(`EXISTS (
          SELECT 1 FROM payment_reference_reservations pr
          JOIN reservations r ON r.id = pr.reservation_id
          WHERE pr.payment_reference_id = p.id AND r.service = ?
          UNION SELECT 1 FROM reservations r
          JOIN payment_references pd ON pd.reservation_id = r.id
          WHERE pd.id = p.id AND r.service = ?
        )`);
        values.push(input.service, input.service);
      }
      if (input.person) {
        conditions.push("(u.email LIKE ? OR u.dni LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)");
        const search = `%${input.person}%`;
        values.push(search, search, search, search);
      }
      if (input.paymentId) {
        conditions.push("(p.id = ? OR p.provider_reference LIKE ?)");
        values.push(input.paymentId, `%${input.paymentId}%`);
      }
      if (input.reservationId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM payment_reference_reservations pr
          WHERE pr.payment_reference_id = p.id AND pr.reservation_id = ?
          UNION SELECT 1 FROM payment_references pd
          WHERE pd.id = p.id AND pd.reservation_id = ?
        )`);
        values.push(input.reservationId, input.reservationId);
      }
      if (input.method) { conditions.push("p.method = ?"); values.push(input.method); }
      if (input.paymentStatus) { conditions.push("p.status = ?"); values.push(input.paymentStatus); }
      if (input.reviewerId) { conditions.push("p.reviewed_by = ?"); values.push(input.reviewerId); }
      if (input.cashShiftId) {
        conditions.push("EXISTS (SELECT 1 FROM cash_receipts cr WHERE cr.payment_reference_id = p.id AND cr.cash_shift_id = ?)");
        values.push(input.cashShiftId);
      }
      if (input.amountFrom) {
        const cents = parseMoneyToCents(input.amountFrom);
        if (cents === null) throw new TRPCError({ code: "BAD_REQUEST", message: "El importe mínimo no es válido." });
        conditions.push("p.amount >= ?"); values.push(moneyCentsToDecimal(cents));
      }
      if (input.amountTo) {
        const cents = parseMoneyToCents(input.amountTo);
        if (cents === null) throw new TRPCError({ code: "BAD_REQUEST", message: "El importe máximo no es válido." });
        conditions.push("p.amount <= ?"); values.push(moneyCentsToDecimal(cents));
      }
      if (input.amountFrom && input.amountTo && parseMoneyToCents(input.amountFrom)! > parseMoneyToCents(input.amountTo)!) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El importe mínimo no puede superar el máximo." });
      }
      if (input.financialStatus === "SIN_EVENTO") conditions.push(`${latestEvent} IS NULL`);
      if (input.financialStatus === "PENDIENTE") {
        conditions.push(`COALESCE(${latestEvent}, '') IN ('COMPROBANTE_PRESENTADO','DOCUMENTACION_VERIFICADA')`);
      }
      if (input.financialStatus === "ACREDITADO") conditions.push(`${latestEvent} = 'ACREDITACION_CONFIRMADA'`);
      if (input.financialStatus === "DIFERENCIA") conditions.push(`${latestEvent} = 'DIFERENCIA_DETECTADA'`);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [countRows] = await pool.execute<Row[]>(
        `SELECT COUNT(*) AS total FROM payment_references p JOIN users u ON u.id = p.user_id ${where}`,
        values
      );
      const offset = (input.page - 1) * input.pageSize;
      const [rows] = await pool.execute<Row[]>(
        `SELECT p.id, p.user_id AS userId, u.first_name AS firstName, u.last_name AS lastName,
                u.email, u.dni, p.provider, p.method, p.provider_reference AS reference,
                p.amount AS declaredAmount, p.currency, p.status AS paymentStatus,
                p.reviewed_by AS reviewerId, p.reviewed_at AS reviewedAt, p.created_at AS createdAt,
                ${latestEvent} AS latestFinanceEvent,
                (SELECT SUM(r.price_amount) FROM reservations r
                 WHERE r.id IN (
                   SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                   UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                 )) AS expectedAmount,
                (SELECT amount FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
                  AND fe.event_type = 'DOCUMENTACION_VERIFICADA' ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1) AS documentedAmount,
                (SELECT amount FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
                  AND fe.event_type = 'ACREDITACION_CONFIRMADA'
                  AND NOT EXISTS (SELECT 1 FROM cash_receipts cr WHERE cr.payment_reference_id = p.id AND cr.status = 'ANULADO')
                  ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1) AS accreditedAmount,
                (SELECT reference FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
                  AND fe.event_type = 'ACREDITACION_CONFIRMADA' ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1) AS institutionalReference,
                (SELECT GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') FROM reservations r
                 WHERE r.id IN (
                   SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                   UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                 )) AS reservationIds,
                (SELECT cash_shift_id FROM cash_receipts WHERE payment_reference_id = p.id LIMIT 1) AS cashShiftId
         FROM payment_references p JOIN users u ON u.id = p.user_id ${where}
         ORDER BY p.created_at DESC, p.id LIMIT ? OFFSET ?`,
        [...values, input.pageSize, offset]
      );
      return { rows, total: Number(countRows[0]?.total ?? 0), page: input.page, pageSize: input.pageSize };
    }),
    summary: permissionProcedure("payments:read").input(z.object({
      dateFrom: dateSchema.optional(), dateTo: dateSchema.optional()
    }).refine((input) => !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, {
      message: "El intervalo de fechas no es válido."
    })).query(async ({ input }) => {
      const paymentRange: string[] = [];
      const paymentValues: string[] = [];
      const eventRange: string[] = [];
      const eventValues: string[] = [];
      const reservationRange: string[] = [];
      const reservationValues: string[] = [];
      if (input.dateFrom) {
        paymentRange.push("DATE(created_at) >= ?"); paymentValues.push(input.dateFrom);
        eventRange.push("DATE(created_at) >= ?"); eventValues.push(input.dateFrom);
        reservationRange.push("service_date >= ?"); reservationValues.push(input.dateFrom);
      }
      if (input.dateTo) {
        paymentRange.push("DATE(created_at) <= ?"); paymentValues.push(input.dateTo);
        eventRange.push("DATE(created_at) <= ?"); eventValues.push(input.dateTo);
        reservationRange.push("service_date <= ?"); reservationValues.push(input.dateTo);
      }
      const paymentWhere = paymentRange.length ? `AND ${paymentRange.join(" AND ")}` : "";
      const reservationWhere = reservationRange.length ? `AND ${reservationRange.join(" AND ")}` : "";
      const [pendingRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(amount), 0) AS declaredPending FROM payment_references
         WHERE status = 'PENDIENTE' ${paymentWhere}`,
        paymentValues
      );
      const [documentedRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(p.amount), 0) AS documentedPending FROM payment_references p
         WHERE p.status = 'PENDIENTE' ${paymentRange.length ? `AND ${paymentRange.map((condition) => condition.replaceAll("created_at", "p.created_at")).join(" AND ")}` : ""}
           AND EXISTS (SELECT 1 FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
             AND fe.event_type = 'DOCUMENTACION_VERIFICADA')`
        , paymentValues
      );
      const [accreditedRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(fe.amount), 0) AS accreditedTotal FROM payment_finance_events fe
         JOIN payment_references p ON p.id = fe.payment_reference_id
         WHERE fe.event_type = 'ACREDITACION_CONFIRMADA' ${eventRange.map((condition) => condition.replaceAll("created_at", "fe.created_at")).reduce((result, condition) => `${result} AND ${condition}`, "")}
           AND NOT EXISTS (SELECT 1 FROM cash_receipts cr WHERE cr.payment_reference_id = p.id AND cr.status = 'ANULADO')`,
        eventValues
      );
      const [refundRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(amount), 0) AS executedRefunds FROM payment_finance_events
         WHERE event_type = 'DEVOLUCION_EJECUTADA' ${eventRange.map((condition) => condition.replaceAll("created_at", "created_at")).reduce((result, condition) => `${result} AND ${condition}`, "")}`,
        eventValues
      );
      const [cashRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(amount), 0) AS confirmedCash FROM cash_receipts
         WHERE status = 'CONFIRMADO' ${paymentRange.length ? `AND ${paymentRange.map((condition) => condition.replaceAll("created_at", "received_at")).join(" AND ")}` : ""}`,
        paymentValues
      );
      const [outstandingRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(price_amount), 0) AS expectedOutstanding FROM reservations
         WHERE payment_status IN ('PENDIENTE','RECHAZADO') AND status = 'PENDIENTE' ${reservationWhere}`,
        reservationValues
      );
      const [legacyRows] = await pool.execute<Row[]>(
        `SELECT COUNT(*) AS legacyApproved FROM payment_references p
         WHERE p.status = 'APROBADO' ${paymentRange.length ? `AND ${paymentRange.map((condition) => condition.replaceAll("created_at", "p.created_at")).join(" AND ")}` : ""}
           AND NOT EXISTS (SELECT 1 FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
             AND fe.event_type = 'ACREDITACION_CONFIRMADA')`,
        paymentValues
      );
      const [appliedRows] = await pool.execute<Row[]>(
        `SELECT COALESCE(SUM(pa.amount), 0) AS appliedTotal FROM payment_allocations pa
         ${paymentRange.length ? `WHERE ${paymentRange.map((condition) => condition.replaceAll("created_at", "pa.created_at")).join(" AND ")} AND` : "WHERE"}
         NOT EXISTS (SELECT 1 FROM cash_receipts cr WHERE cr.payment_reference_id = pa.payment_reference_id AND cr.status = 'ANULADO')`,
        paymentValues
      );
      return {
        declaredPending: String(pendingRows[0]?.declaredPending ?? "0.00"),
        documentedPending: String(documentedRows[0]?.documentedPending ?? "0.00"),
        accreditedTotal: String(accreditedRows[0]?.accreditedTotal ?? "0.00"),
        executedRefunds: String(refundRows[0]?.executedRefunds ?? "0.00"),
        confirmedCash: String(cashRows[0]?.confirmedCash ?? "0.00"),
        expectedOutstanding: String(outstandingRows[0]?.expectedOutstanding ?? "0.00"),
        appliedTotal: String(appliedRows[0]?.appliedTotal ?? "0.00"),
        legacyApprovedForReview: Number(legacyRows[0]?.legacyApproved ?? 0)
      };
    }),
    detail: permissionProcedure("payments:read").input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
      const [payments] = await pool.execute<Row[]>(
        `SELECT p.id, p.user_id AS userId, u.first_name AS firstName, u.last_name AS lastName,
                u.email, u.dni, p.provider, p.method, p.provider_reference AS reference,
                p.amount AS declaredAmount, p.currency, p.status AS paymentStatus,
                p.reviewed_by AS reviewerId, p.reviewed_at AS reviewedAt, p.created_at AS createdAt
         FROM payment_references p JOIN users u ON u.id = p.user_id WHERE p.id = ? LIMIT 1`,
        [input.id]
      );
      if (!payments[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el pago." });
      const [reservations] = await pool.execute<Row[]>(
        `SELECT r.id, r.service_date AS serviceDate, r.service, r.price_amount AS expectedAmount,
                r.price_currency AS currency, r.payment_status AS paymentStatus, r.approval_status AS approvalStatus
         FROM reservations r WHERE r.id IN (
           SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = ?
           UNION SELECT reservation_id FROM payment_references WHERE id = ? AND reservation_id IS NOT NULL
         ) ORDER BY r.service_date, r.service`,
        [input.id, input.id]
      );
      const [allocations] = await pool.execute<Row[]>(
        `SELECT reservation_id AS reservationId, amount, currency, allocated_by AS allocatedBy, created_at AS createdAt
         FROM payment_allocations WHERE payment_reference_id = ? ORDER BY created_at, id`,
        [input.id]
      );
      const [events] = await pool.execute<Row[]>(
        `SELECT id, event_type AS eventType, amount, currency, reference, note,
                actor_id AS actorId, created_at AS createdAt
         FROM payment_finance_events WHERE payment_reference_id = ? ORDER BY created_at, id`,
        [input.id]
      );
      const [evidence] = await pool.execute<Row[]>(
        `SELECT id, submitted_by AS submittedBy, provider_reference AS reference, method,
                declared_amount AS declaredAmount, currency, mime_type AS mimeType, created_at AS createdAt
         FROM payment_evidence WHERE payment_reference_id = ? ORDER BY created_at, id`,
        [input.id]
      );
      const [adjustments] = await pool.execute<Row[]>(
        `SELECT id, adjustment_type AS adjustmentType, status, amount, currency, reason,
                requested_by AS requestedBy, requested_at AS requestedAt,
                authorized_by AS authorizedBy, authorized_at AS authorizedAt,
                executed_by AS executedBy, executed_at AS executedAt, execution_reference AS executionReference
         FROM finance_adjustments WHERE payment_reference_id = ? ORDER BY requested_at, id`,
        [input.id]
      );
      const [cashReceipts] = await pool.execute<Row[]>(
        `SELECT id, receipt_number AS receiptNumber, cash_shift_id AS cashShiftId,
                received_by AS receivedBy, amount, currency, status, received_at AS receivedAt,
                voided_by AS voidedBy, voided_at AS voidedAt, void_reason AS voidReason
         FROM cash_receipts WHERE payment_reference_id = ? ORDER BY received_at, id`,
        [input.id]
      );
      return { payment: payments[0], reservations, allocations, events, evidence, adjustments, cashReceipts };
    }),
    export: permissionProcedure("payments:export").input(z.object({
      dateFrom: dateSchema.optional(), dateTo: dateSchema.optional(), service: serviceSchema.optional()
    }).refine((input) => !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, {
      message: "El intervalo de fechas no es válido."
    })).mutation(async ({ ctx, input }) => {
      const conditions: string[] = [];
      const values: string[] = [];
      if (input.dateFrom) { conditions.push("DATE(p.created_at) >= ?"); values.push(input.dateFrom); }
      if (input.dateTo) { conditions.push("DATE(p.created_at) <= ?"); values.push(input.dateTo); }
      if (input.service) {
        conditions.push(`EXISTS (
          SELECT 1 FROM payment_reference_reservations pr
          JOIN reservations r ON r.id = pr.reservation_id
          WHERE pr.payment_reference_id = p.id AND r.service = ?
          UNION SELECT 1 FROM reservations r
          JOIN payment_references pd ON pd.reservation_id = r.id
          WHERE pd.id = p.id AND r.service = ?
        )`);
        values.push(input.service, input.service);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const serviceValues = Array(8).fill(input.service ?? null) as Array<string | null>;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT p.id, CONCAT(u.first_name, ' ', u.last_name) AS person, u.dni,
                  p.provider_reference AS reference, p.method, p.amount AS declaredAmount, p.currency,
                  p.status AS paymentStatus,
                  (SELECT SUM(r.price_amount) FROM reservations r
                   WHERE r.id IN (
                     SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                     UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                   ) AND (? IS NULL OR r.service = ?)) AS expectedAmount,
                  CASE WHEN ? IS NULL THEN p.amount
                    WHEN NOT EXISTS (
                      SELECT 1 FROM reservations r
                      WHERE r.id IN (
                        SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                        UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                      ) AND r.service <> ?
                    ) THEN p.amount
                    ELSE (SELECT CASE WHEN COUNT(r.id) = COUNT(pa.id) AND COUNT(r.id) > 0 THEN SUM(pa.amount) END
                      FROM reservations r
                      LEFT JOIN payment_allocations pa ON pa.payment_reference_id = p.id AND pa.reservation_id = r.id
                      WHERE r.id IN (
                        SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                        UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                      ) AND r.service = ?) END AS declaredAmount,
                  CASE WHEN ? IS NULL THEN (SELECT fe.amount FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
                      AND fe.event_type = 'ACREDITACION_CONFIRMADA'
                      AND NOT EXISTS (SELECT 1 FROM cash_receipts cr WHERE cr.payment_reference_id = p.id AND cr.status = 'ANULADO')
                      ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1)
                    WHEN NOT EXISTS (
                      SELECT 1 FROM reservations r
                      WHERE r.id IN (
                        SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                        UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                      ) AND r.service <> ?
                    ) THEN (SELECT fe.amount FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
                      AND fe.event_type = 'ACREDITACION_CONFIRMADA'
                      AND NOT EXISTS (SELECT 1 FROM cash_receipts cr WHERE cr.payment_reference_id = p.id AND cr.status = 'ANULADO')
                      ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1)
                    ELSE (SELECT CASE WHEN COUNT(r.id) = COUNT(pa.id) AND COUNT(r.id) > 0 THEN SUM(pa.amount) END
                      FROM reservations r
                      LEFT JOIN payment_allocations pa ON pa.payment_reference_id = p.id AND pa.reservation_id = r.id
                      WHERE r.id IN (
                        SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                        UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                      ) AND r.service = ?) END AS accreditedAmount,
                  (SELECT fe.event_type FROM payment_finance_events fe WHERE fe.payment_reference_id = p.id
                    ORDER BY fe.created_at DESC, fe.id DESC LIMIT 1) AS financialStatus,
                  (SELECT GROUP_CONCAT(DISTINCT r.service ORDER BY r.service SEPARATOR ',') FROM reservations r
                   WHERE r.id IN (
                     SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                     UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                   )) AS services,
                  (SELECT GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') FROM reservations r
                   WHERE r.id IN (
                     SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = p.id
                     UNION SELECT reservation_id FROM payment_references WHERE id = p.id AND reservation_id IS NOT NULL
                   )) AS reservationIds
           FROM payment_references p JOIN users u ON u.id = p.user_id ${where}
           ORDER BY p.created_at DESC, p.id`,
          [...serviceValues, ...values]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "finance.report_export", resourceType: "financial_report",
          metadata: {
            rowCount: rows.length, dateFrom: input.dateFrom ?? null,
            dateTo: input.dateTo ?? null, service: input.service ?? null, actorRole: ctx.user.role
          }
        });
        await connection.commit();
        const sum = (key: "expectedAmount" | "declaredAmount" | "accreditedAmount") => {
          const cents = sumMoneyToCents(rows.flatMap((row) =>
            row[key] == null ? [] : [String(row[key])]
          ));
          if (cents === null) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudieron calcular los totales financieros." });
          return moneyCentsToDecimal(cents);
        };
        const totals = {
          payments: rows.length,
          expectedAmount: sum("expectedAmount"),
          declaredAmount: sum("declaredAmount"),
          accreditedAmount: sum("accreditedAmount"),
          pending: rows.filter((row) => row.paymentStatus === "PENDIENTE").length,
          rejected: rows.filter((row) => row.paymentStatus === "RECHAZADO").length,
          refunded: rows.filter((row) => row.paymentStatus === "REEMBOLSADO").length,
          differences: rows.filter((row) => row.financialStatus === "DIFERENCIA_DETECTADA").length,
          unallocatedForService: input.service
            ? rows.filter((row) => row.declaredAmount == null).length : 0
        };
        return {
          rows,
          generatedAt: new Date().toISOString(),
          filters: { dateFrom: input.dateFrom ?? null, dateTo: input.dateTo ?? null, service: input.service ?? null },
          totals
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    requestAdjustment: permissionProcedure("payments:manage").input(z.object({
      paymentReferenceId: z.string().uuid(),
      adjustmentType: z.enum(["DEVOLUCION", "AJUSTE", "ANULACION"]),
      amount: z.string().trim().max(20),
      reason: z.string().trim().min(5).max(1000)
    })).mutation(async ({ ctx, input }) => {
      const amountCents = parseMoneyToCents(input.amount);
      if (amountCents === null || amountCents <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El importe del ajuste no es válido." });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [payments] = await connection.execute<Row[]>(
          "SELECT status, currency FROM payment_references WHERE id = ? FOR UPDATE",
          [input.paymentReferenceId]
        );
        const payment = payments[0];
        if (!payment || payment.status !== "APROBADO") {
          throw new TRPCError({ code: "CONFLICT", message: "Solo se puede ajustar un pago ya aprobado." });
        }
        const [accreditations] = await connection.execute<Row[]>(
          `SELECT amount FROM payment_finance_events
           WHERE payment_reference_id = ? AND event_type = 'ACREDITACION_CONFIRMADA'
           ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [input.paymentReferenceId]
        );
        const accreditedCents = parseMoneyToCents(String(accreditations[0]?.amount ?? ""));
        if (accreditedCents === null) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El pago no tiene acreditación confirmada; no se puede ajustar." });
        }
        const [previousAdjustments] = await connection.execute<Row[]>(
          `SELECT amount FROM finance_adjustments
           WHERE payment_reference_id = ? AND status IN ('SOLICITADA','AUTORIZADA','EJECUTADA','APLICADA') FOR UPDATE`,
          [input.paymentReferenceId]
        );
        const alreadyReserved = previousAdjustments.reduce((sum, adjustment) => {
          const cents = parseMoneyToCents(String(adjustment.amount));
          return cents === null ? sum : sum + cents;
        }, 0);
        if (amountCents + alreadyReserved > accreditedCents) {
          throw new TRPCError({ code: "CONFLICT", message: "El ajuste supera el saldo acreditado disponible." });
        }
        const id = randomUUID();
        await connection.execute(
          `INSERT INTO finance_adjustments
           (id, payment_reference_id, adjustment_type, amount, currency, reason, requested_by, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'SOLICITADA')`,
          [id, input.paymentReferenceId, input.adjustmentType, moneyCentsToDecimal(amountCents), String(payment.currency), input.reason, ctx.user.id]
        );
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, note, actor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), input.paymentReferenceId, input.adjustmentType === "DEVOLUCION" ? "DEVOLUCION_SOLICITADA" : "AJUSTE_REGISTRADO",
            moneyCentsToDecimal(amountCents), String(payment.currency), input.reason, ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "finance.adjustment_request", resourceType: "finance_adjustment", resourceId: id,
          metadata: { adjustmentType: input.adjustmentType, amountCents, reason: input.reason, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { id, status: "SOLICITADA" as const };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    reviewAdjustment: permissionProcedure("payments:adjustments:manage").input(z.object({
      id: z.string().uuid(), decision: z.enum(["AUTORIZADA", "RECHAZADA"]), note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
            `SELECT payment_reference_id AS paymentReferenceId, adjustment_type AS adjustmentType,
              amount, currency, status, reason, requested_by AS requestedBy
           FROM finance_adjustments WHERE id = ? FOR UPDATE`,
          [input.id]
        );
        const adjustment = rows[0];
        if (!adjustment) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el ajuste." });
        if (adjustment.status !== "SOLICITADA") throw new TRPCError({ code: "CONFLICT", message: "La solicitud ya fue resuelta." });
        if (String(adjustment.requestedBy) === ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No podés autorizar una solicitud que iniciaste." });
        }
        await connection.execute(
          `UPDATE finance_adjustments SET status = ?, authorized_by = ?, authorized_at = CURRENT_TIMESTAMP,
           execution_note = ? WHERE id = ?`,
          [input.decision, ctx.user.id, input.note ?? null, input.id]
        );
        const isRefund = adjustment.adjustmentType === "DEVOLUCION";
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, note, actor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), String(adjustment.paymentReferenceId),
            isRefund ? input.decision === "AUTORIZADA" ? "DEVOLUCION_AUTORIZADA" : "DEVOLUCION_RECHAZADA" : "AJUSTE_REGISTRADO",
            String(adjustment.amount), String(adjustment.currency), input.note ?? String(adjustment.reason), ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "finance.adjustment_review", resourceType: "finance_adjustment", resourceId: input.id,
          metadata: { adjustmentType: String(adjustment.adjustmentType), previousStatus: String(adjustment.status), newStatus: input.decision, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    recordAdjustmentExecution: permissionProcedure("payments:adjustments:manage").input(z.object({
      id: z.string().uuid(), executionReference: z.string().trim().min(3).max(191), note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT payment_reference_id AS paymentReferenceId, adjustment_type AS adjustmentType,
                  amount, currency, status, reason FROM finance_adjustments WHERE id = ? FOR UPDATE`,
          [input.id]
        );
        const adjustment = rows[0];
        if (!adjustment) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el ajuste." });
        if (adjustment.status !== "AUTORIZADA") throw new TRPCError({ code: "CONFLICT", message: "Solo puede ejecutarse un ajuste autorizado." });
        await connection.execute(
          `UPDATE finance_adjustments SET status = 'EJECUTADA', executed_by = ?, executed_at = CURRENT_TIMESTAMP,
           execution_reference = ?, execution_note = ? WHERE id = ? AND status = 'AUTORIZADA'`,
          [ctx.user.id, input.executionReference, input.note ?? String(adjustment.reason), input.id]
        );
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), String(adjustment.paymentReferenceId), adjustment.adjustmentType === "DEVOLUCION" ? "DEVOLUCION_EJECUTADA" : "AJUSTE_REGISTRADO",
            String(adjustment.amount), String(adjustment.currency), input.executionReference, input.note ?? String(adjustment.reason), ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "finance.adjustment_execute", resourceType: "finance_adjustment", resourceId: input.id,
          metadata: { adjustmentType: String(adjustment.adjustmentType), amount: String(adjustment.amount), executionReference: input.executionReference, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true, status: "EJECUTADA" as const };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    cashShifts: permissionProcedure("payments:cash:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT s.id, s.opened_by AS openedBy, opener.first_name AS openerFirstName, opener.last_name AS openerLastName,
                s.opening_balance AS openingBalance, s.opened_at AS openedAt, s.status,
                s.closed_by AS closedBy, s.closed_at AS closedAt, s.expected_cash AS expectedCash,
                s.counted_cash AS countedCash, s.difference, s.close_note AS closeNote,
                s.reviewed_by AS reviewedBy, s.reviewed_at AS reviewedAt,
                (SELECT COALESCE(SUM(r.amount), 0) FROM cash_receipts r WHERE r.cash_shift_id = s.id AND r.status = 'CONFIRMADO') AS totalCash
         FROM cash_shifts s JOIN users opener ON opener.id = s.opened_by
         ORDER BY FIELD(s.status, 'ABIERTA', 'CERRADA'), s.opened_at DESC LIMIT 100`
      );
      return rows;
    }),
    cashReceivables: permissionProcedure("payments:cash:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT r.id AS reservationId, r.user_id AS userId, u.first_name AS firstName,
                u.last_name AS lastName, u.dni, r.service_date AS serviceDate, r.service,
                r.price_amount AS amount, r.price_currency AS currency, r.payment_status AS paymentStatus
         FROM reservations r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'PENDIENTE' AND r.payment_status IN ('PENDIENTE','RECHAZADO')
           AND r.approval_status <> 'RECHAZADA' AND r.price_amount > 0
           AND NOT EXISTS (
             SELECT 1 FROM payment_references p
             WHERE (p.reservation_id = r.id OR p.id IN (
               SELECT pr.payment_reference_id FROM payment_reference_reservations pr WHERE pr.reservation_id = r.id
             )) AND p.status <> 'RECHAZADO'
           )
         ORDER BY r.service_date, r.service, u.last_name, u.first_name LIMIT 500`
      );
      return rows;
    }),
    openCashShift: permissionProcedure("payments:cash:manage").input(z.object({
      openingBalance: z.string().trim().max(20), note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const openingCents = parseMoneyToCents(input.openingBalance);
      if (openingCents === null) throw new TRPCError({ code: "BAD_REQUEST", message: "El saldo inicial no es válido." });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [ctx.user.id]);
        const [openShifts] = await connection.execute<Row[]>(
          "SELECT id FROM cash_shifts WHERE active_operator_id = ? AND status = 'ABIERTA' FOR UPDATE",
          [ctx.user.id]
        );
        if (openShifts.length) throw new TRPCError({ code: "CONFLICT", message: "Ya tenés una caja abierta." });
        const id = randomUUID();
        await connection.execute(
          `INSERT INTO cash_shifts (id, active_operator_id, opened_by, opening_balance, opening_note, status)
           VALUES (?, ?, ?, ?, ?, 'ABIERTA')`,
          [id, ctx.user.id, ctx.user.id, moneyCentsToDecimal(openingCents), input.note ?? null]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "cash.shift_open", resourceType: "cash_shift", resourceId: id,
          metadata: { openingCents, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    registerCash: permissionProcedure("payments:cash:manage").input(z.object({
      userId: z.string().uuid(), reservationIds: z.array(z.string().uuid()).min(1).max(20),
      receivedAmount: z.string().trim().max(20), note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      if (new Set(input.reservationIds).size !== input.reservationIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La selección contiene reservas duplicadas." });
      }
      const receivedCents = parseMoneyToCents(input.receivedAmount);
      if (receivedCents === null || receivedCents <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El importe recibido no es válido." });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [shiftRows] = await connection.execute<Row[]>(
          `SELECT id FROM cash_shifts WHERE active_operator_id = ? AND status = 'ABIERTA' FOR UPDATE`,
          [ctx.user.id]
        );
        const shift = shiftRows[0];
        if (!shift) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Abrí tu caja antes de registrar efectivo." });
        const placeholders = input.reservationIds.map(() => "?").join(", ");
        const [reservations] = await connection.execute<Row[]>(
          `SELECT id, user_id AS userId, price_amount AS priceAmount, price_currency AS currency,
                  payment_status AS paymentStatus, approval_status AS approvalStatus, status
           FROM reservations WHERE id IN (${placeholders}) AND user_id = ? ORDER BY id FOR UPDATE`,
          [...input.reservationIds, input.userId]
        );
        if (reservations.length !== input.reservationIds.length || reservations.some((reservation) =>
          reservation.status !== "PENDIENTE" || !["PENDIENTE", "RECHAZADO"].includes(String(reservation.paymentStatus)) ||
          reservation.approvalStatus === "RECHAZADA" || Number(reservation.priceAmount) <= 0
        )) {
          throw new TRPCError({ code: "CONFLICT", message: "Una o más reservas no admiten un cobro en efectivo." });
        }
        const currencies = new Set(reservations.map((reservation) => String(reservation.currency)));
        if (currencies.size !== 1) throw new TRPCError({ code: "CONFLICT", message: "No se pueden agrupar reservas con monedas distintas." });
        const expectedCents = sumMoneyToCents(reservations.map((reservation) => String(reservation.priceAmount)));
        if (expectedCents === null) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo calcular el importe histórico." });
        if (receivedCents !== expectedCents) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `El efectivo debe coincidir con el importe esperado de ${moneyCentsToDecimal(expectedCents)} ${String(reservations[0]?.currency)}.` });
        }
        const [existingPayments] = await connection.execute<Row[]>(
          `SELECT p.id, p.status FROM payment_references p
           WHERE p.reservation_id IN (${placeholders})
           UNION SELECT p.id, p.status FROM payment_reference_reservations pr
           JOIN payment_references p ON p.id = pr.payment_reference_id
           WHERE pr.reservation_id IN (${placeholders}) FOR UPDATE`,
          [...input.reservationIds, ...input.reservationIds]
        );
        if (existingPayments.some((payment) => payment.status !== "RECHAZADO")) {
          throw new TRPCError({ code: "CONFLICT", message: "Una o más reservas ya tienen un pago pendiente o confirmado." });
        }
        const paymentId = randomUUID();
        const temporaryReference = `RECIBO-PENDIENTE-${randomUUID()}`;
        const currency = String(reservations[0]?.currency);
        await connection.execute(
          `INSERT INTO payment_references
           (id, user_id, reservation_id, provider, provider_reference, method, amount, currency, status, reviewed_by, reviewed_at)
           VALUES (?, ?, NULL, 'EFECTIVO', ?, 'EFECTIVO', ?, ?, 'APROBADO', ?, CURRENT_TIMESTAMP)`,
          [paymentId, input.userId, temporaryReference, moneyCentsToDecimal(expectedCents), currency, ctx.user.id]
        );
        const associationPlaceholders = input.reservationIds.map(() => "(?, ?)").join(", ");
        await connection.execute(
          `INSERT INTO payment_reference_reservations (payment_reference_id, reservation_id) VALUES ${associationPlaceholders}`,
          input.reservationIds.flatMap((reservationId) => [paymentId, reservationId])
        );
        const receiptId = randomUUID();
        const [receiptInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO cash_receipts (id, cash_shift_id, payment_reference_id, received_by, amount, currency, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [receiptId, String(shift.id), paymentId, ctx.user.id, moneyCentsToDecimal(expectedCents), currency, input.note ?? null]
        );
        const receiptNumber = Number(receiptInsert.insertId);
        const receiptReference = `RECIBO-${String(receiptNumber).padStart(8, "0")}`;
        await connection.execute("UPDATE payment_references SET provider_reference = ? WHERE id = ?", [receiptReference, paymentId]);
        for (const reservation of reservations) {
          await connection.execute(
            `INSERT INTO payment_allocations
             (id, payment_reference_id, reservation_id, amount, currency, allocated_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), paymentId, String(reservation.id), String(reservation.priceAmount), currency, ctx.user.id]
          );
        }
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
           VALUES (?, ?, 'COBRO_EFECTIVO', ?, ?, ?, ?, ?),
                  (?, ?, 'ACREDITACION_CONFIRMADA', ?, ?, ?, ?, ?)`,
          [randomUUID(), paymentId, moneyCentsToDecimal(expectedCents), currency, receiptReference, input.note ?? null, ctx.user.id,
            randomUUID(), paymentId, moneyCentsToDecimal(expectedCents), currency, receiptReference, "Recepción física confirmada por el responsable de caja.", ctx.user.id]
        );
        await connection.execute(
          `UPDATE reservations SET payment_status = 'PAGADO', status = 'CONFIRMADA',
           approval_status = 'APROBADA', approval_actor_id = ?,
           approval_role_snapshot = ?, approval_updated_at = CURRENT_TIMESTAMP
           WHERE id IN (${placeholders}) AND status = 'PENDIENTE'`,
          [ctx.user.id, ctx.user.role, ...input.reservationIds]
        );
        for (const reservation of reservations) {
          if (reservation.approvalStatus !== "APROBADA") {
            await writeAudit(connection, {
              actorId: ctx.user.id, action: "reservation.approved_by_payment",
              resourceType: "reservation", resourceId: String(reservation.id),
              metadata: { paymentReferenceId: paymentId, actorRole: ctx.user.role, paymentMethod: "EFECTIVO" }
            });
          }
          const ticket = await issueTicketForReservation(connection, String(reservation.id));
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
            [randomUUID(), input.userId, "Turno confirmado", `El pago fue confirmado. Tu turno es el ${ticket.ticketNumber} y el ticket ya está disponible.`]
          );
        }
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "cash.receipt_confirm", resourceType: "cash_receipt", resourceId: receiptId,
          metadata: { receiptNumber, paymentId, reservationCount: reservations.length, amountCents: expectedCents, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { id: receiptId, receiptNumber, paymentId, amount: moneyCentsToDecimal(expectedCents), currency };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    closeCashShift: permissionProcedure("payments:cash:manage").input(z.object({
      id: z.string().uuid(), countedCash: z.string().trim().max(20), note: z.string().trim().max(1000).optional()
    })).mutation(async ({ ctx, input }) => {
      const countedCents = parseMoneyToCents(input.countedCash);
      if (countedCents === null) throw new TRPCError({ code: "BAD_REQUEST", message: "El efectivo contado no es válido." });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT id, opened_by AS openedBy, opening_balance AS openingBalance, status
           FROM cash_shifts WHERE id = ? FOR UPDATE`,
          [input.id]
        );
        const shift = rows[0];
        if (!shift || shift.status !== "ABIERTA") throw new TRPCError({ code: "CONFLICT", message: "La caja ya está cerrada o no existe." });
        if (String(shift.openedBy) !== ctx.user.id && ctx.user.role !== "SUPERVISOR") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo quien abrió la caja o un Supervisor puede cerrarla." });
        }
        const [receipts] = await connection.execute<Row[]>(
          `SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_receipts
           WHERE cash_shift_id = ? AND status = 'CONFIRMADO'`,
          [input.id]
        );
        const receiptCents = parseMoneyToCents(String(receipts[0]?.amount ?? "0.00"));
        const openingCents = parseMoneyToCents(String(shift.openingBalance));
        if (receiptCents === null || openingCents === null) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo calcular el saldo teórico de caja." });
        const closure = calculateCashClosure(openingCents, receiptCents, countedCents);
        if (!closure) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo calcular el cierre de caja." });
        const expectedCents = closure.expectedCents;
        const differenceCents = closure.differenceCents;
        await connection.execute(
          `UPDATE cash_shifts SET active_operator_id = NULL, status = 'CERRADA', closed_by = ?, closed_at = CURRENT_TIMESTAMP,
           expected_cash = ?, counted_cash = ?, difference = ?, close_note = ? WHERE id = ? AND status = 'ABIERTA'`,
          [ctx.user.id, moneyCentsToDecimal(expectedCents), moneyCentsToDecimal(countedCents), moneyCentsToDecimal(differenceCents), input.note ?? null, input.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "cash.shift_close", resourceType: "cash_shift", resourceId: input.id,
          metadata: { openingCents, receiptCents, expectedCents, countedCents, differenceCents, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true, expectedCash: moneyCentsToDecimal(expectedCents), countedCash: moneyCentsToDecimal(countedCents), difference: moneyCentsToDecimal(differenceCents) };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    voidCashReceipt: permissionProcedure("payments:reconcile").input(z.object({
      id: z.string().uuid(), reason: z.string().trim().min(5).max(1000)
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT cr.status, cr.payment_reference_id AS paymentReferenceId, cr.amount, cr.currency,
                  cr.receipt_number AS receiptNumber, p.user_id AS userId
           FROM cash_receipts cr JOIN payment_references p ON p.id = cr.payment_reference_id
           WHERE cr.id = ? FOR UPDATE`,
          [input.id]
        );
        const receipt = rows[0];
        if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el recibo." });
        if (receipt.status !== "CONFIRMADO") throw new TRPCError({ code: "CONFLICT", message: "El recibo ya fue anulado." });
        const paymentReferenceId = String(receipt.paymentReferenceId);
        const [reservations] = await connection.execute<Row[]>(
          `SELECT r.id, r.status FROM reservations r WHERE r.id IN (
             SELECT reservation_id FROM payment_reference_reservations WHERE payment_reference_id = ?
             UNION SELECT reservation_id FROM payment_references WHERE id = ? AND reservation_id IS NOT NULL
           ) ORDER BY r.id FOR UPDATE`,
          [paymentReferenceId, paymentReferenceId]
        );
        if (!reservations.length || reservations.some((reservation) => reservation.status === "UTILIZADA")) {
          throw new TRPCError({ code: "CONFLICT", message: "No se puede anular un recibo aplicado a un servicio ya utilizado." });
        }
        await connection.execute(
          `UPDATE cash_receipts SET status = 'ANULADO', voided_by = ?, voided_at = CURRENT_TIMESTAMP, void_reason = ?
           WHERE id = ? AND status = 'CONFIRMADO'`,
          [ctx.user.id, input.reason, input.id]
        );
        await connection.execute(
          `UPDATE payment_references SET status = 'RECHAZADO', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'APROBADO'`,
          [ctx.user.id, paymentReferenceId]
        );
        const reservationIds = reservations.map((reservation) => String(reservation.id));
        const placeholders = reservationIds.map(() => "?").join(", ");
        await connection.execute(
          `UPDATE reservations SET payment_status = 'RECHAZADO', status = 'PENDIENTE'
           WHERE id IN (${placeholders}) AND status = 'CONFIRMADA'`,
          reservationIds
        );
        await connection.execute(
          `INSERT INTO payment_finance_events
           (id, payment_reference_id, event_type, amount, currency, reference, note, actor_id)
           VALUES (?, ?, 'AJUSTE_REGISTRADO', ?, ?, ?, ?, ?)`,
          [randomUUID(), paymentReferenceId, String(receipt.amount), String(receipt.currency), `RECIBO-${String(receipt.receiptNumber).padStart(8, "0")}`, `Recibo anulado. Motivo: ${input.reason}`, ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "cash.receipt_void", resourceType: "cash_receipt", resourceId: input.id,
          metadata: { receiptNumber: Number(receipt.receiptNumber), paymentReferenceId, reason: input.reason, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    reviewCashDifference: permissionProcedure("payments:reconcile").input(z.object({
      id: z.string().uuid(), note: z.string().trim().min(5).max(1000)
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          "SELECT status, difference, reviewed_at AS reviewedAt FROM cash_shifts WHERE id = ? FOR UPDATE",
          [input.id]
        );
        const shift = rows[0];
        if (!shift || shift.status !== "CERRADA" || shift.difference == null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos un cierre de caja para revisar." });
        }
        if (shift.reviewedAt) throw new TRPCError({ code: "CONFLICT", message: "La diferencia ya fue revisada." });
        await connection.execute(
          "UPDATE cash_shifts SET reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
          [ctx.user.id, input.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "cash.difference_review", resourceType: "cash_shift", resourceId: input.id,
          metadata: { difference: String(shift.difference), note: input.note, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  pricing: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      let scholarshipType: string | null = null;
      if (ctx.user.role === "ALUMNO") {
        const [scholarships] = await pool.execute<Row[]>(
          `SELECT scholarship_type AS scholarshipType FROM scholarships
           WHERE user_id = ? AND status = 'APROBADA'
             AND (valid_from IS NULL OR valid_from <= CURDATE())
             AND (valid_until IS NULL OR valid_until >= CURDATE())
           ORDER BY valid_from DESC LIMIT 1`,
          [ctx.user.id]
        );
        scholarshipType = scholarships[0]?.scholarshipType ? String(scholarships[0].scholarshipType) : "SIN_BECA";
      }
      const [rows] = await pool.execute<Row[]>(
        `SELECT amount, currency, scholarship_type AS scholarshipType, valid_from AS validFrom
         FROM price_history WHERE role = ? AND (scholarship_type = ? OR (scholarship_type IS NULL AND ? IS NULL))
           AND valid_from <= CURDATE() AND (valid_until IS NULL OR valid_until >= CURDATE())
         ORDER BY valid_from DESC LIMIT 1`,
        [ctx.user.role, scholarshipType, scholarshipType]
      );
      return rows[0] ?? null;
    }),
    history: permissionProcedure("prices:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, role, scholarship_type AS scholarshipType, amount, currency,
                valid_from AS validFrom, valid_until AS validUntil, created_at AS createdAt
         FROM price_history ORDER BY valid_from DESC, role LIMIT 300`
      );
      return rows;
    }),
    set: permissionProcedure("prices:manage").input(z.object({
      role: z.enum(roles), scholarshipType: scholarshipSchema.nullable().optional(),
      amount: z.number().min(0).max(100000), validFrom: dateSchema
    })).mutation(async ({ ctx, input }) => {
      const scholarshipType = input.role === "ALUMNO" ? input.scholarshipType ?? null : null;
      if (input.role === "ALUMNO" && !scholarshipType) throw new TRPCError({ code: "BAD_REQUEST", message: "Seleccioná el tipo de beca para la tarifa de estudiantes." });
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [current] = await connection.execute<Row[]>(
          `SELECT id, amount, valid_from AS validFrom FROM price_history
           WHERE role = ? AND (scholarship_type = ? OR (scholarship_type IS NULL AND ? IS NULL))
             AND valid_until IS NULL ORDER BY valid_from DESC FOR UPDATE`,
          [input.role, scholarshipType, scholarshipType]
        );
        const active = current[0];
        if (active) {
          const activeStart = String(active.validFrom).slice(0, 10);
          if (input.validFrom <= activeStart) {
            throw new TRPCError({ code: "CONFLICT", message: "La nueva tarifa debe comenzar después de la tarifa vigente." });
          }
          await connection.execute("UPDATE price_history SET valid_until = ? WHERE id = ?", [previousDate(input.validFrom), active.id]);
        }
        const id = randomUUID();
        await connection.execute(
          `INSERT INTO price_history (id, role, scholarship_type, amount, currency, valid_from, changed_by)
           VALUES (?, ?, ?, ?, 'ARS', ?, ?)`,
          [id, input.role, scholarshipType, input.amount.toFixed(2), input.validFrom, ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "price.set", resourceType: "price_history", resourceId: id,
          metadata: {
            role: input.role, scholarshipType: scholarshipType ?? "", previousAmount: active ? Number(active.amount) : null,
            amount: input.amount, validFrom: input.validFrom, actorRole: ctx.user.role
          }
        });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  administration: router({
    usersReport: permissionProcedure("users:read").input(z.object({
      dateFrom: dateSchema.optional(),
      dateTo: dateSchema.optional(),
      role: z.enum(roles).optional(),
      scholarshipType: scholarshipSchema.optional(),
      status: z.enum(["PENDING", "ACTIVE", "SUSPENDED"]).optional(),
      search: z.string().trim().max(100).optional()
    }).refine((input) => !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, {
      message: "El intervalo de fechas no es válido."
    })).mutation(async ({ ctx, input }) => {
      const conditions: string[] = [];
      const values: Array<string | number | null> = [];
      if (input.dateFrom) { conditions.push("DATE(u.created_at) >= ?"); values.push(input.dateFrom); }
      if (input.dateTo) { conditions.push("DATE(u.created_at) <= ?"); values.push(input.dateTo); }
      if (input.role) { conditions.push("u.role = ?"); values.push(input.role); }
      if (input.status) { conditions.push("u.status = ?"); values.push(input.status); }
      if (input.search) {
        conditions.push("(u.first_name LIKE ? OR u.last_name LIKE ? OR u.dni LIKE ? OR u.email LIKE ?)");
        const search = `%${input.search}%`;
        values.push(search, search, search, search);
      }
      const asOfDate = input.dateTo ?? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires"
      }).format(new Date());
      const scholarshipAtDate = `(SELECT s.scholarship_type FROM scholarships s
        WHERE s.user_id = u.id AND s.status = 'APROBADA'
          AND (s.valid_from IS NULL OR s.valid_from <= ?)
          AND (s.valid_until IS NULL OR s.valid_until >= ?)
        ORDER BY s.valid_from DESC, s.created_at DESC LIMIT 1)`;
      if (input.scholarshipType) {
        conditions.push(`u.role = 'ALUMNO' AND COALESCE(${scholarshipAtDate}, 'SIN_BECA') = ?`);
        values.push(asOfDate, asOfDate, input.scholarshipType);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<Row[]>(
          `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, u.dni,
                  u.email, u.role, u.status, u.created_at AS createdAt,
                  CASE WHEN u.role = 'ALUMNO'
                    THEN COALESCE(${scholarshipAtDate}, 'SIN_BECA')
                    ELSE NULL END AS scholarshipType
           FROM users u ${where}
           ORDER BY u.role, scholarshipType, u.last_name, u.first_name, u.id`,
          [asOfDate, asOfDate, ...values]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "user.report_export", resourceType: "user_report",
          metadata: {
            rowCount: rows.length,
            filters: JSON.stringify({
              dateFrom: input.dateFrom ?? null, dateTo: input.dateTo ?? null,
              role: input.role ?? null, scholarshipType: input.scholarshipType ?? null,
              status: input.status ?? null, searchApplied: Boolean(input.search)
            }),
            actorRole: ctx.user.role
          }
        });
        await connection.commit();
        const reportRows = rows.map((row) => ({
          id: String(row.id),
          firstName: String(row.firstName),
          lastName: String(row.lastName),
          dni: row.dni == null ? null : String(row.dni),
          email: String(row.email),
          role: String(row.role),
          status: String(row.status),
          createdAt: String(row.createdAt),
          scholarshipType: row.scholarshipType == null ? null : String(row.scholarshipType)
        }));
        return {
          rows: reportRows,
          generatedAt: new Date().toISOString(),
          filters: {
            dateFrom: input.dateFrom ?? null, dateTo: input.dateTo ?? null,
            role: input.role ?? null, scholarshipType: input.scholarshipType ?? null,
            status: input.status ?? null, search: input.search ?? null
          }
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    report: permissionProcedure("statistics:read")
      .input(z.object({
        period: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).default("DAILY"),
        date: dateSchema.optional()
      }))
      .query(async ({ input }) => {
        const range = reportRange(input.period, input.date);
        const [serviceRows] = await pool.execute<Row[]>(
          `SELECT service, COUNT(*) AS reservations,
                  SUM(status = 'UTILIZADA') AS consumed,
                  SUM(status = 'CANCELADA' AND approval_status <> 'RECHAZADA') AS cancelled,
                  SUM(approval_status = 'RECHAZADA') AS rejected,
                  SUM(no_show_at IS NOT NULL) AS noShows,
                  SUM(price_amount) AS reservedAmount
           FROM reservations
           WHERE service_date >= ? AND service_date < ?
           GROUP BY service ORDER BY service`,
          [range.from, range.to]
        );
        const [paymentRows] = await pool.execute<Row[]>(
          `SELECT COALESCE(SUM(amount), 0) AS verifiedPayments
           FROM payment_references
           WHERE status = 'APROBADO' AND reviewed_at >= ? AND reviewed_at < ?`,
          [`${range.from} 00:00:00`, `${range.to} 00:00:00`]
        );
        const services = serviceRows.map((row) => ({
          service: String(row.service),
          reservations: Number(row.reservations ?? 0),
          consumed: Number(row.consumed ?? 0),
          cancelled: Number(row.cancelled ?? 0),
          rejected: Number(row.rejected ?? 0),
          noShows: Number(row.noShows ?? 0),
          reservedAmount: Number(row.reservedAmount ?? 0)
        }));
        return {
          ...range,
          services,
          totals: services.reduce((totals, row) => ({
            reservations: totals.reservations + row.reservations,
            consumed: totals.consumed + row.consumed,
            cancelled: totals.cancelled + row.cancelled,
            rejected: totals.rejected + row.rejected,
            noShows: totals.noShows + row.noShows,
            reservedAmount: totals.reservedAmount + row.reservedAmount
          }), { reservations: 0, consumed: 0, cancelled: 0, rejected: 0, noShows: 0, reservedAmount: 0 }),
          verifiedPayments: Number(paymentRows[0]?.verifiedPayments ?? 0)
        };
      }),
    summary: permissionProcedure("statistics:read").query(async () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
      const [rows] = await pool.execute<Row[]>(
        `SELECT
          (SELECT COUNT(*) FROM reservations WHERE service_date = ? AND status <> 'CANCELADA') AS todayReservations,
          (SELECT COUNT(*) FROM reservations WHERE service_date = ? AND no_show_at IS NOT NULL) AS todayNoShows,
          (SELECT COUNT(*) FROM tickets WHERE service_date = ? AND status = 'UTILIZADO') AS todayConsumed,
          (SELECT COUNT(*) FROM users WHERE status = 'ACTIVE') AS activeUsers,
          (SELECT COUNT(*) FROM incidents WHERE status IN ('ABIERTO', 'EN_INVESTIGACION')) AS openIncidents`,
        [today, today, today]
      );
      const [capacity] = await pool.execute<Row[]>(
        `SELECT c.service, c.capacity, COALESCE(s.booked, 0) AS booked
         FROM service_capacity_config c LEFT JOIN capacity_slots s
         ON s.service = c.service AND s.service_date = ? ORDER BY c.service`,
        [today]
      );
      const summary = rows[0];
      return {
        todayReservations: Number(summary?.todayReservations ?? 0),
        todayNoShows: Number(summary?.todayNoShows ?? 0),
        todayConsumed: Number(summary?.todayConsumed ?? 0),
        activeUsers: Number(summary?.activeUsers ?? 0),
        openIncidents: Number(summary?.openIncidents ?? 0),
        capacity: capacity.map((row) => ({
          service: String(row.service),
          capacity: Number(row.capacity),
          booked: Number(row.booked)
        }))
      };
    }),
    audit: permissionProcedure("audit:read")
      .input(z.object({
        from: dateSchema.optional(), to: dateSchema.optional(),
        user: z.string().trim().max(100).optional(),
        role: z.enum(roles).optional(),
        module: z.string().trim().max(80).optional(),
        action: z.string().trim().max(100).optional(),
        resourceId: z.string().trim().max(36).optional()
      }).optional())
      .query(async ({ input }) => {
        if (input?.from && input.to && input.to < input.from) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha final debe ser igual o posterior a la inicial." });
        }
        const user = input?.user?.trim() ?? "";
        const module = input?.module?.trim() ?? "";
        const action = input?.action?.trim() ?? "";
        const resourceId = input?.resourceId?.trim() ?? "";
      const [rows] = await pool.execute<Row[]>(
        `SELECT a.id, a.actor_id AS actorId, a.action, a.resource_type AS resourceType,
                a.resource_id AS resourceId, a.outcome, a.metadata, a.created_at AS createdAt,
                u.email, u.first_name AS firstName, u.last_name AS lastName,
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.actorRole')), u.role) AS actorRole
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE (? IS NULL OR a.created_at >= ?)
           AND (? IS NULL OR a.created_at < DATE_ADD(?, INTERVAL 1 DAY))
           AND (? = '' OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR a.actor_id = ?)
           AND (? IS NULL OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.actorRole')), u.role) = ?)
           AND (? = '' OR a.resource_type = ?)
           AND (? = '' OR a.action LIKE ?)
           AND (? = '' OR a.resource_id LIKE ?)
         ORDER BY a.created_at DESC LIMIT 200`,
        [
          input?.from ?? null, input?.from ?? null, input?.to ?? null, input?.to ?? null,
          user, `%${user}%`, `%${user}%`, `%${user}%`, user,
          input?.role ?? null, input?.role ?? null, module, module,
          action, `%${action}%`, resourceId, `%${resourceId}%`
        ]
      );
      return rows;
      }),
    ticketScans: permissionProcedure("tickets:validate").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT s.id, s.ticket_id AS ticketId, s.reservation_id AS reservationId,
                s.result, s.scanned_at AS scannedAt, u.first_name AS firstName, u.last_name AS lastName
         FROM ticket_scans s JOIN users u ON u.id = s.operator_id
         ORDER BY s.scanned_at DESC LIMIT 100`
      );
      return rows;
    }),
    roles: permissionProcedure("users:manage").query(({ ctx }) => assignableRolesForActor(ctx.user.role)),
    createUser: permissionProcedure("users:create").input(z.object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
      dni: z.string().trim().regex(/^\d{7,10}$/).optional(),
      role: z.enum(roles),
      password: z.string().min(10).max(128)
    })).mutation(async ({ ctx, input }) => {
      if (!assignableRolesForActor(ctx.user.role).includes(input.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "El Administrador Local solo puede crear cuentas de usuarios del comedor." });
      }
      const id = randomUUID();
      const passwordHash = await hashPassword(input.password);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `INSERT INTO users (id, email, dni, first_name, last_name, password_hash, role, status, is_demo)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
          [id, input.email, input.dni ?? null, input.firstName, input.lastName, passwordHash, input.role]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "user.create", resourceType: "user", resourceId: id,
          metadata: { role: input.role, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "CONFLICT", message: "Ya existe una cuenta con ese correo o DNI." });
        }
        throw error;
      } finally {
        connection.release();
      }
    }),
    users: permissionProcedure("users:read").input(z.object({
      search: z.string().trim().max(100).optional()
    }).optional()).query(async ({ input }) => {
      const search = input?.search?.trim() ?? "";
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, email, dni, first_name AS firstName, last_name AS lastName,
                role, status, created_at AS createdAt
         FROM users WHERE (? = '' OR email LIKE ? OR dni LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
         ORDER BY created_at DESC LIMIT 200`,
        [search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`]
      );
      return rows;
    }),
    updateUser: permissionProcedure("users:manage").input(z.object({
      id: z.string().uuid(), role: z.enum(roles), status: z.enum(["PENDING", "ACTIVE", "SUSPENDED"])
    })).mutation(async ({ ctx, input }) => {
      if (!assignableRolesForActor(ctx.user.role).includes(input.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No podés asignar ese rol." });
      }
      if (input.id === ctx.user.id && (input.role !== ctx.user.role || input.status !== "ACTIVE")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No podés quitarte tu propio rol ni suspender tu cuenta activa." });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [users] = await connection.execute<Row[]>("SELECT id, role, status FROM users WHERE id = ? FOR UPDATE", [input.id]);
        if (!users[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el usuario." });
        if (!assignableRolesForActor(ctx.user.role).includes(String(users[0].role) as (typeof roles)[number])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No podés modificar una cuenta con ese rol." });
        }
        await connection.execute("UPDATE users SET role = ?, status = ? WHERE id = ?", [input.role, input.status, input.id]);
        if (users[0].status === "PENDING" && input.status === "ACTIVE") {
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
            [randomUUID(), input.id, "Cuenta habilitada", "Tu cuenta fue validada por personal autorizado. Ya podés iniciar sesión."]
          );
        }
        await writeAudit(connection, {
          actorId: ctx.user.id,
          action: users[0].status === "PENDING" && input.status === "ACTIVE" ? "user.review_approve"
            : users[0].status === "PENDING" && input.status === "SUSPENDED" ? "user.review_reject"
              : "user.update",
          resourceType: "user", resourceId: input.id,
          metadata: {
            previousRole: String(users[0].role), newRole: input.role,
            previousStatus: String(users[0].status), newStatus: input.status,
            actorRole: ctx.user.role
          }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
    capacityConfig: permissionProcedure("settings:manage").query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT service, capacity, booking_opens_at AS bookingOpensAt,
                booking_closes_at AS bookingClosesAt, presentation_deadline_at AS presentationDeadlineAt,
                booking_enabled AS bookingEnabled
         FROM service_capacity_config ORDER BY service`
      );
      return rows;
    }),
    closures: permissionProcedure("settings:manage").query(async () => {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires"
      }).format(new Date());
      const [rows] = await pool.execute<Row[]>(
        `SELECT sc.id, sc.service_date AS serviceDate, sc.service, sc.reason,
                sc.created_at AS createdAt, u.first_name AS createdByFirstName,
                u.last_name AS createdByLastName
         FROM service_closures sc JOIN users u ON u.id = sc.created_by
         WHERE sc.service_date >= ?
         ORDER BY sc.service_date, sc.service LIMIT 300`,
        [today]
      );
      return rows;
    }),
    addClosure: permissionProcedure("settings:manage").input(z.object({
      date: dateSchema,
      service: serviceSchema,
      reason: z.string().trim().min(3).max(250)
    })).mutation(async ({ ctx, input }) => {
      if (!isInstitutionalBusinessDay(input.date)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Los cierres deben corresponder a un día laborable." });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("SELECT service FROM service_capacity_config WHERE service = ? FOR UPDATE", [input.service]);
        const id = randomUUID();
        await connection.execute(
          "INSERT INTO service_closures (id, service_date, service, reason, created_by) VALUES (?, ?, ?, ?, ?)",
          [id, input.date, input.service, input.reason, ctx.user.id]
        );
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "service.closure_create",
          resourceType: "service_closure", resourceId: id,
          metadata: { serviceDate: input.date, service: input.service, reason: input.reason, actorRole: ctx.user.role }
        });
        await connection.commit();
        return { id };
      } catch (error) {
        await connection.rollback();
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "CONFLICT", message: "Ya existe un cierre para esa fecha y servicio." });
        }
        throw error;
      } finally {
        connection.release();
      }
    }),
    removeClosure: permissionProcedure("settings:manage").input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [rows] = await connection.execute<Row[]>(
            "SELECT service_date AS serviceDate, service, reason FROM service_closures WHERE id = ? FOR UPDATE",
            [input.id]
          );
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos el cierre." });
          await connection.execute("SELECT service FROM service_capacity_config WHERE service = ? FOR UPDATE", [rows[0].service]);
          await connection.execute("DELETE FROM service_closures WHERE id = ?", [input.id]);
          await writeAudit(connection, {
            actorId: ctx.user.id, action: "service.closure_remove",
            resourceType: "service_closure", resourceId: input.id,
            metadata: {
              serviceDate: String(rows[0].serviceDate).slice(0, 10),
              service: String(rows[0].service), reason: String(rows[0].reason), actorRole: ctx.user.role
            }
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    updateCapacity: permissionProcedure("settings:manage").input(z.object({
      service: serviceSchema, capacity: z.number().int().min(1).max(100000),
      bookingOpensAt: timeSchema, bookingClosesAt: timeSchema,
      presentationDeadlineAt: timeSchema, bookingEnabled: z.boolean()
    })).mutation(async ({ ctx, input }) => {
      if (input.bookingClosesAt <= input.bookingOpensAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El cierre de reservas debe ser posterior a la apertura." });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
        const [currentConfig] = await connection.execute<Row[]>(
          `SELECT capacity, booking_opens_at AS bookingOpensAt, booking_closes_at AS bookingClosesAt,
                  presentation_deadline_at AS presentationDeadlineAt, booking_enabled AS bookingEnabled
           FROM service_capacity_config WHERE service = ? FOR UPDATE`,
          [input.service]
        );
        if (!currentConfig[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos la configuración del servicio." });
        const [fullSlots] = await connection.execute<Row[]>(
          `SELECT service_date AS serviceDate, booked FROM capacity_slots
           WHERE service = ? AND service_date >= ? AND booked > ? FOR UPDATE`,
          [input.service, today, input.capacity]
        );
        if (fullSlots.length) throw new TRPCError({ code: "CONFLICT", message: "El nuevo cupo es menor que reservas ya confirmadas en fechas futuras." });
        await connection.execute(
          `UPDATE service_capacity_config SET capacity = ?, booking_opens_at = ?, booking_closes_at = ?,
           presentation_deadline_at = ?, booking_enabled = ? WHERE service = ?`,
          [input.capacity, input.bookingOpensAt, input.bookingClosesAt, input.presentationDeadlineAt, input.bookingEnabled, input.service]
        );
        await connection.execute(
          "UPDATE capacity_slots SET capacity = ? WHERE service = ? AND service_date >= ?",
          [input.capacity, input.service, today]
        );
        const [availableSlots] = await connection.execute<Row[]>(
          `SELECT service_date AS serviceDate FROM capacity_slots
           WHERE service = ? AND service_date >= ? AND booked < capacity
           ORDER BY service_date FOR UPDATE`,
          [input.service, today]
        );
        for (const slot of availableSlots) {
          await promoteWaitlistForSlot(connection, String(slot.serviceDate).slice(0, 10), input.service);
        }
        await writeAudit(connection, {
          actorId: ctx.user.id, action: "capacity.configure", resourceType: "service_capacity_config",
          metadata: {
            service: input.service, previousCapacity: Number(currentConfig[0].capacity), capacity: input.capacity,
            previousOpensAt: String(currentConfig[0].bookingOpensAt), opensAt: input.bookingOpensAt,
            previousClosesAt: String(currentConfig[0].bookingClosesAt), closesAt: input.bookingClosesAt,
            previousDeadlineAt: String(currentConfig[0].presentationDeadlineAt), deadlineAt: input.presentationDeadlineAt,
            previousEnabled: Boolean(currentConfig[0].bookingEnabled), enabled: input.bookingEnabled,
            actorRole: ctx.user.role
          }
        });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })
  }),
  notifications: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT id, title, body, read_at AS readAt, created_at AS createdAt FROM notifications
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
        [ctx.user.id]
      );
      return rows;
    }),
    markRead: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const [result] = await pool.execute(
        "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        [input.id, ctx.user.id]
      );
      if (("affectedRows" in result ? result.affectedRows : 0) === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos esa notificación." });
      return { success: true };
    })
  }),
  profile: router({
    accessibility: protectedProcedure.query(async ({ ctx }) => {
      const [rows] = await pool.execute<Row[]>(
        "SELECT accessibility_preferences AS preferences FROM users WHERE id = ? AND status = 'ACTIVE'",
        [ctx.user.id]
      );
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos tu perfil activo." });
      const value = rows[0]?.preferences;
      if (value == null) return { preferences: defaultAccessibilityPreferences, configured: false };
      let parsed: unknown = value;
      if (typeof value === "string") {
        try {
          parsed = JSON.parse(value) as unknown;
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudieron leer tus preferencias de accesibilidad." });
        }
      }
      const result = accessibilityPreferencesSchema.safeParse(parsed);
      if (!result.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Tus preferencias de accesibilidad guardadas no son válidas." });
      return { preferences: result.data, configured: true };
    }),
    updateAccessibility: protectedProcedure
      .input(accessibilityPreferencesSchema)
      .mutation(async ({ ctx, input }) => {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            "UPDATE users SET accessibility_preferences = ? WHERE id = ? AND status = 'ACTIVE'",
            [JSON.stringify(input), ctx.user.id]
          );
          await writeAudit(connection, {
            actorId: ctx.user.id,
            action: "profile.accessibility_update",
            resourceType: "user",
            resourceId: ctx.user.id
          });
          await connection.commit();
          return { success: true };
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }),
    update: protectedProcedure.input(z.object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      dni: z.string().trim().regex(/^\d{7,10}$/, "El DNI debe tener entre 7 y 10 números.").nullable(),
      phone: z.string().trim().max(30).nullable()
    })).mutation(async ({ ctx, input }) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          "UPDATE users SET first_name = ?, last_name = ?, dni = ?, phone = ? WHERE id = ? AND status = 'ACTIVE'",
          [input.firstName, input.lastName, input.dni || null, input.phone || null, ctx.user.id]
        );
        await writeAudit(connection, { actorId: ctx.user.id, action: "profile.update", resourceType: "user", resourceId: ctx.user.id });
        await connection.commit();
        return { success: true };
      } catch (error) {
        await connection.rollback();
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "CONFLICT", message: "Ese DNI ya está asociado a otra cuenta." });
        }
        throw error;
      } finally {
        connection.release();
      }
    }),
    prices: protectedProcedure.query(async () => {
      const [rows] = await pool.execute<Row[]>(
        `SELECT role, scholarship_type AS scholarshipType, amount, currency, valid_from AS validFrom FROM price_history
         WHERE valid_from <= CURDATE() AND (valid_until IS NULL OR valid_until >= CURDATE())
         ORDER BY role`
      );
      return rows;
    })
  })
});

export type AppRouter = typeof appRouter;
