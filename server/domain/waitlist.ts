import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { Service } from "../../shared/domain";
import {
  configuredDeadlineUtc, isDeadlineReached, isReservationDateAllowed, isWithinBookingWindow, startOfWeek
} from "../../shared/domain";
import { pool } from "../db";
import { writeAudit } from "../db/audit";

type WaitlistRow = RowDataPacket & Record<string, unknown>;
export const WAITLIST_OFFER_MINUTES = 60;

function argentinaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function argentinaTime(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function followingWeek(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

async function promoteWaitlist(connection: PoolConnection, serviceDate: string, service: Service) {
  if (serviceDate < argentinaToday()) return;

  const [configRows] = await connection.execute<WaitlistRow[]>(
    `SELECT booking_enabled AS bookingEnabled, booking_opens_at AS bookingOpensAt,
            booking_closes_at AS bookingClosesAt, presentation_deadline_at AS presentationDeadlineAt
     FROM service_capacity_config WHERE service = ?`,
    [service]
  );
  const serviceConfig = configRows[0];
  if (!serviceConfig || !serviceConfig.bookingEnabled ||
      isDeadlineReached(configuredDeadlineUtc(serviceDate, String(serviceConfig.presentationDeadlineAt)))) {
    return;
  }

  const [slotRows] = await connection.execute<WaitlistRow[]>(
    `SELECT capacity, booked FROM capacity_slots
     WHERE service_date = ? AND service = ? FOR UPDATE`,
    [serviceDate, service]
  );
  const slot = slotRows[0];
  if (!slot) return;

  while (Number(slot.booked) < Number(slot.capacity)) {
    const [entries] = await connection.execute<WaitlistRow[]>(
      `SELECT id, user_id AS userId FROM reservation_waitlist
       WHERE service_date = ? AND service = ? AND status = 'WAITING'
       ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
      [serviceDate, service]
    );
    const entry = entries[0];
    if (!entry) return;

    const weekStart = startOfWeek(serviceDate);
    const weekEnd = followingWeek(weekStart);
    const [eligibilityRows] = await connection.execute<WaitlistRow[]>(
      `SELECT u.status,
              (SELECT COUNT(*) FROM reservations r
               WHERE r.user_id = u.id AND r.service_date >= ? AND r.service_date < ?
                 AND r.status <> 'CANCELADA') AS weeklyReservations,
              EXISTS(SELECT 1 FROM reservations r
                     WHERE r.user_id = u.id AND r.service_date = ? AND r.service = ?
                       AND r.status <> 'CANCELADA') AS alreadyReserved
       FROM users u WHERE u.id = ?`,
      [weekStart, weekEnd, serviceDate, service, entry.userId]
    );
    const eligibility = eligibilityRows[0];
    if (!eligibility || eligibility.status !== "ACTIVE" ||
        Number(eligibility.weeklyReservations) >= 5 || Number(eligibility.alreadyReserved) > 0) {
      await connection.execute(
        `UPDATE reservation_waitlist SET status = 'CANCELLED', cancelled_at = UTC_TIMESTAMP()
         WHERE id = ? AND status = 'WAITING'`,
        [entry.id]
      );
      await writeAudit(connection, {
        actorId: null, action: "waitlist.skip_ineligible", resourceType: "waitlist", resourceId: String(entry.id),
        metadata: { serviceDate, service, reason: !eligibility ? "USER_MISSING" : String(eligibility.status) !== "ACTIVE" ? "USER_INACTIVE" : Number(eligibility.weeklyReservations) >= 5 ? "WEEKLY_LIMIT" : "ALREADY_RESERVED" }
      });
      continue;
    }

    const [holdResult] = await connection.execute<ResultSetHeader>(
      `UPDATE capacity_slots SET booked = booked + 1
       WHERE service_date = ? AND service = ? AND booked < capacity`,
      [serviceDate, service]
    );
    if (!holdResult.affectedRows) return;
    const [offerResult] = await connection.execute<ResultSetHeader>(
      `UPDATE reservation_waitlist
       SET status = 'OFFERED', offered_at = UTC_TIMESTAMP(),
           expires_at = LEAST(
             DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${WAITLIST_OFFER_MINUTES} MINUTE),
             TIMESTAMPADD(HOUR, 3, TIMESTAMP(?, ?))
           )
       WHERE id = ? AND status = 'WAITING'`,
      [serviceDate, serviceConfig.presentationDeadlineAt, entry.id]
    );
    if (!offerResult.affectedRows) {
      await connection.execute(
        "UPDATE capacity_slots SET booked = GREATEST(booked - 1, 0) WHERE service_date = ? AND service = ?",
        [serviceDate, service]
      );
      continue;
    }
    await connection.execute(
      "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
      [randomUUID(), entry.userId, "Se liberó un cupo", `Tenés ${WAITLIST_OFFER_MINUTES} minutos para confirmar tu lugar de ${service.toLowerCase()} del ${serviceDate}, antes del horario límite del servicio.`]
    );
    await writeAudit(connection, {
      actorId: null, action: "waitlist.offer", resourceType: "waitlist", resourceId: String(entry.id),
      metadata: { serviceDate, service, expiresInMinutes: WAITLIST_OFFER_MINUTES }
    });
    slot.booked = Number(slot.booked) + 1;
  }
}

export async function joinWaitlist(userId: string, serviceDate: string, service: Service) {
  if (!isReservationDateAllowed(serviceDate, argentinaToday())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Solo podés anotarte para hoy o una fecha futura." });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<WaitlistRow[]>(
      "SELECT id, status FROM users WHERE id = ? FOR UPDATE", [userId]
    );
    if (!users[0] || users[0].status !== "ACTIVE") {
      throw new TRPCError({ code: "FORBIDDEN", message: "La cuenta no está habilitada para anotarse." });
    }

    const [settings] = await connection.execute<WaitlistRow[]>(
      `SELECT capacity, booking_enabled AS bookingEnabled, booking_opens_at AS bookingOpensAt,
              booking_closes_at AS bookingClosesAt
       FROM service_capacity_config WHERE service = ?`,
      [service]
    );
    const serviceConfig = settings[0];
    if (!serviceConfig || !serviceConfig.bookingEnabled ||
        !isWithinBookingWindow(argentinaTime(), String(serviceConfig.bookingOpensAt), String(serviceConfig.bookingClosesAt))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La lista de espera solo está disponible durante la ventana de reservas." });
    }

    const weekStart = startOfWeek(serviceDate);
    const weekEnd = followingWeek(weekStart);
    const [existing] = await connection.execute<WaitlistRow[]>(
      `SELECT
         (SELECT COUNT(*) FROM reservations WHERE user_id = ? AND service_date >= ? AND service_date < ? AND status <> 'CANCELADA') AS weeklyReservations,
         EXISTS(SELECT 1 FROM reservations WHERE user_id = ? AND service_date = ? AND service = ? AND status <> 'CANCELADA') AS alreadyReserved,
         EXISTS(SELECT 1 FROM reservation_waitlist WHERE user_id = ? AND service_date = ? AND service = ? AND status IN ('WAITING','OFFERED')) AS alreadyWaiting`,
      [userId, weekStart, weekEnd, userId, serviceDate, service, userId, serviceDate, service]
    );
    if (Number(existing[0].weeklyReservations) >= 5) {
      throw new TRPCError({ code: "CONFLICT", message: "Ya alcanzaste el máximo de 5 reservas en esa semana." });
    }
    if (Number(existing[0].alreadyReserved) > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Ya tenés una reserva activa para ese servicio y esa fecha." });
    }
    if (Number(existing[0].alreadyWaiting) > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Ya estás en la lista de espera para ese servicio." });
    }

    await connection.execute(
      `INSERT INTO capacity_slots (service_date, service, capacity, booked, next_ticket_number)
       VALUES (?, ?, ?, 0, 1) ON DUPLICATE KEY UPDATE service = VALUES(service)`,
      [serviceDate, service, Number(serviceConfig.capacity)]
    );
    const [slots] = await connection.execute<WaitlistRow[]>(
      `SELECT capacity, booked FROM capacity_slots WHERE service_date = ? AND service = ? FOR UPDATE`,
      [serviceDate, service]
    );
    if (!slots[0] || Number(slots[0].booked) < Number(slots[0].capacity)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Todavía hay cupos disponibles. Reservá normalmente en lugar de usar la lista de espera." });
    }
    const id = randomUUID();
    await connection.execute(
      "INSERT INTO reservation_waitlist (id, user_id, service_date, service, status) VALUES (?, ?, ?, ?, 'WAITING')",
      [id, userId, serviceDate, service]
    );
    await writeAudit(connection, {
      actorId: userId, action: "waitlist.join", resourceType: "waitlist", resourceId: id,
      metadata: { serviceDate, service }
    });
    const [positionRows] = await connection.execute<WaitlistRow[]>(
      `SELECT COUNT(*) AS ahead FROM reservation_waitlist
       WHERE service_date = ? AND service = ? AND status = 'WAITING'
         AND (created_at < (SELECT created_at FROM reservation_waitlist WHERE id = ?)
              OR (created_at = (SELECT created_at FROM reservation_waitlist WHERE id = ?) AND id <= ?))`,
      [serviceDate, service, id, id, id]
    );
    await connection.commit();
    return { id, position: Number(positionRows[0].ahead) };
  } catch (error) {
    await connection.rollback();
    if (error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY") {
      throw new TRPCError({ code: "CONFLICT", message: "Ya estás en la lista de espera para ese servicio." });
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function cancelWaitlistEntry(userId: string, entryId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [entries] = await connection.execute<WaitlistRow[]>(
      `SELECT service_date AS serviceDate, service FROM reservation_waitlist
       WHERE id = ? AND user_id = ?`,
      [entryId, userId]
    );
    const entry = entries[0];
    if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos tu lugar en la lista de espera." });
    const serviceDate = String(entry.serviceDate).slice(0, 10);
    const service = entry.service as Service;
    await connection.execute(
      `SELECT service_date FROM capacity_slots WHERE service_date = ? AND service = ? FOR UPDATE`,
      [serviceDate, service]
    );
    const [lockedEntries] = await connection.execute<WaitlistRow[]>(
      `SELECT status FROM reservation_waitlist WHERE id = ? AND user_id = ? FOR UPDATE`,
      [entryId, userId]
    );
    const status = String(lockedEntries[0]?.status);
    if (!lockedEntries[0] || !["WAITING", "OFFERED"].includes(status)) {
      throw new TRPCError({ code: "CONFLICT", message: "Ese lugar ya no se puede cancelar." });
    }
    await connection.execute(
      `UPDATE reservation_waitlist SET status = 'CANCELLED', cancelled_at = UTC_TIMESTAMP() WHERE id = ?`,
      [entryId]
    );
    if (status === "OFFERED") {
      await connection.execute(
        "UPDATE capacity_slots SET booked = GREATEST(booked - 1, 0) WHERE service_date = ? AND service = ?",
        [serviceDate, service]
      );
      await promoteWaitlist(connection, serviceDate, service);
    }
    await writeAudit(connection, {
      actorId: userId, action: "waitlist.cancel", resourceType: "waitlist", resourceId: entryId,
      metadata: { serviceDate, service, previousStatus: status }
    });
    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function promoteWaitlistForSlot(connection: PoolConnection, serviceDate: string, service: Service) {
  await promoteWaitlist(connection, serviceDate, service);
}

export async function expireWaitlistOffers() {
  const [rows] = await pool.execute<WaitlistRow[]>(
    `SELECT DISTINCT service_date AS serviceDate, service
     FROM reservation_waitlist
     WHERE status = 'OFFERED' AND expires_at <= UTC_TIMESTAMP()
     ORDER BY service_date, service`
  );
  for (const row of rows) {
    const serviceDate = String(row.serviceDate).slice(0, 10);
    const service = row.service as Service;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `SELECT service_date FROM capacity_slots WHERE service_date = ? AND service = ? FOR UPDATE`,
        [serviceDate, service]
      );
      const [expired] = await connection.execute<WaitlistRow[]>(
        `SELECT id, user_id AS userId FROM reservation_waitlist
         WHERE service_date = ? AND service = ? AND status = 'OFFERED'
           AND expires_at <= UTC_TIMESTAMP() FOR UPDATE`,
        [serviceDate, service]
      );
      if (expired.length) {
        await connection.execute(
          `UPDATE reservation_waitlist SET status = 'EXPIRED'
           WHERE service_date = ? AND service = ? AND status = 'OFFERED'
             AND expires_at <= UTC_TIMESTAMP()`,
          [serviceDate, service]
        );
        await connection.execute(
          `UPDATE capacity_slots SET booked = GREATEST(booked - ?, 0)
           WHERE service_date = ? AND service = ?`,
          [expired.length, serviceDate, service]
        );
        for (const entry of expired) {
          await connection.execute(
            "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
            [randomUUID(), entry.userId, "Venció tu turno", `El plazo para confirmar tu lugar de ${service.toLowerCase()} del ${serviceDate} venció.`]
          );
          await writeAudit(connection, {
            actorId: null, action: "waitlist.offer_expired", resourceType: "waitlist", resourceId: String(entry.id),
            metadata: { serviceDate, service }
          });
        }
        await promoteWaitlist(connection, serviceDate, service);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  const [waitingRows] = await pool.execute<WaitlistRow[]>(
    `SELECT w.id, w.user_id AS userId, w.service_date AS serviceDate, w.service
     FROM reservation_waitlist w
     JOIN service_capacity_config c ON c.service = w.service
     WHERE w.status = 'WAITING'
       AND TIMESTAMPADD(HOUR, 3, TIMESTAMP(w.service_date, c.presentation_deadline_at)) <= UTC_TIMESTAMP()
     ORDER BY w.service_date, w.service, w.created_at`
  );
  for (const row of waitingRows) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [entries] = await connection.execute<WaitlistRow[]>(
        `SELECT id FROM reservation_waitlist
         WHERE id = ? AND status = 'WAITING' FOR UPDATE`,
        [row.id]
      );
      if (entries[0]) {
        await connection.execute(
          `UPDATE reservation_waitlist SET status = 'EXPIRED'
           WHERE id = ? AND status = 'WAITING'`,
          [row.id]
        );
        await connection.execute(
          "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
          [randomUUID(), row.userId, "Lista de espera cerrada", `El servicio de ${String(row.service).toLowerCase()} del ${String(row.serviceDate).slice(0, 10)} ya no admite confirmaciones.`]
        );
        await writeAudit(connection, {
          actorId: null, action: "waitlist.closed", resourceType: "waitlist", resourceId: String(row.id),
          metadata: { serviceDate: String(row.serviceDate).slice(0, 10), service: String(row.service) }
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  const [openSlots] = await pool.execute<WaitlistRow[]>(
    `SELECT DISTINCT w.service_date AS serviceDate, w.service
     FROM reservation_waitlist w
     JOIN capacity_slots s ON s.service_date = w.service_date AND s.service = w.service
     WHERE w.status = 'WAITING' AND w.service_date >= ? AND s.booked < s.capacity
     ORDER BY w.service_date, w.service`,
    [argentinaToday()]
  );
  for (const row of openSlots) {
    const serviceDate = String(row.serviceDate).slice(0, 10);
    const service = row.service as Service;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `SELECT service_date FROM capacity_slots WHERE service_date = ? AND service = ? FOR UPDATE`,
        [serviceDate, service]
      );
      await promoteWaitlist(connection, serviceDate, service);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
