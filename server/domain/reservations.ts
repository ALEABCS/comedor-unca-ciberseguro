import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolConnection } from "mysql2/promise";
import type { Service } from "../../shared/domain";
import { canBook, configuredDeadlineUtc, isCancellationAllowed, isDeadlineReached, isInstitutionalBusinessDay, isReservationDateAllowed, isTicketEligible, isWithinBookingWindow, startOfWeek } from "../../shared/domain";
import { pool } from "../db";
import { writeAudit } from "../db/audit";
import { promoteWaitlistForSlot } from "./waitlist";

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

function argentinaDeadlineUtc(date: string, time: string): string {
  return configuredDeadlineUtc(date, time).toISOString().slice(0, 19).replace("T", " ");
}

function followingWeek(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
}

export async function issueTicketForReservation(
  connection: PoolConnection,
  reservationId: string
): Promise<{ ticketId: string; ticketNumber: number }> {
  const [reservations] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT service_date AS serviceDate, service, queue_number AS queueNumber, status, approval_status AS approvalStatus,
            payment_status AS paymentStatus
     FROM reservations WHERE id = ? FOR UPDATE`,
    [reservationId]
  );
  const reservation = reservations[0];
  if (!reservation ||
      reservation.status !== "CONFIRMADA" ||
      !isTicketEligible(String(reservation.approvalStatus), String(reservation.paymentStatus))) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El ticket solo se emite cuando la reserva está aprobada y su pago está resuelto."
    });
  }

  const [existing] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT id, daily_number AS ticketNumber FROM tickets WHERE reservation_id = ? FOR UPDATE",
    [reservationId]
  );
  if (existing[0]) {
    return {
      ticketId: String(existing[0].id),
      ticketNumber: Number(existing[0].ticketNumber)
    };
  }

  const serviceDate = String(reservation.serviceDate).slice(0, 10);
  const service = String(reservation.service) as Service;
  const ticketNumber = Number(reservation.queueNumber);
  if (!Number.isSafeInteger(ticketNumber) || ticketNumber < 1) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "La reserva no tiene un número de orden asignado." });
  }

  const ticketId = randomUUID();
  await connection.execute(
    `INSERT INTO tickets (id, reservation_id, service_date, service, daily_number, status)
     VALUES (?, ?, ?, ?, ?, 'DISPONIBLE')`,
    [ticketId, reservationId, serviceDate, service, ticketNumber]
  );
  return { ticketId, ticketNumber };
}

export async function createReservation(userId: string, serviceDate: string, service: Service, waitlistEntryId?: string) {
  if (!isReservationDateAllowed(serviceDate, argentinaToday())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Solo podés reservar para hoy o una fecha futura." });
  }
  if (!isInstitutionalBusinessDay(serviceDate)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El comedor atiende de lunes a viernes." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT id, dni, role, status FROM users WHERE id = ? FOR UPDATE", [userId]
    );
    if (!users[0] || users[0].status !== "ACTIVE") throw new TRPCError({ code: "FORBIDDEN", message: "La cuenta no está habilitada para reservar." });

    const [settings] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT capacity, booking_enabled, booking_opens_at, booking_closes_at, presentation_deadline_at FROM service_capacity_config WHERE service = ? FOR UPDATE", [service]
    );
    if (!settings[0] || (!settings[0].booking_enabled && !waitlistEntryId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Las reservas para este servicio no están habilitadas." });
    const [closures] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT reason FROM service_closures WHERE service_date = ? AND service = ? LIMIT 1",
      [serviceDate, service]
    );
    if (closures[0]) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `El servicio no recibirá reservas para esta fecha: ${String(closures[0].reason)}`
      });
    }
    const nowTime = argentinaTime();
    if (!waitlistEntryId && !isWithinBookingWindow(nowTime, String(settings[0].booking_opens_at), String(settings[0].booking_closes_at))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La ventana de reserva para este servicio está cerrada." });
    }
    if (!waitlistEntryId) {
      const [offers] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM reservation_waitlist
         WHERE user_id = ? AND service_date = ? AND service = ? AND status = 'OFFERED'
         LIMIT 1`,
        [userId, serviceDate, service]
      );
      if (offers[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "Tenés un cupo ofrecido. Confirmalo o salí de la lista antes de crear otra reserva." });
      }
    }

    await connection.execute(
      `INSERT INTO capacity_slots (service_date, service, capacity, booked, next_ticket_number)
       VALUES (?, ?, ?, 0, 1) ON DUPLICATE KEY UPDATE service = VALUES(service)`,
      [serviceDate, service, Number(settings[0].capacity)]
    );
    const [slots] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT capacity, booked, next_ticket_number AS nextTicketNumber FROM capacity_slots WHERE service_date = ? AND service = ? FOR UPDATE",
      [serviceDate, service]
    );
    const slot = slots[0];
    if (!slot) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo verificar el cupo." });
    const queueNumber = Number(slot.nextTicketNumber);
    if (!Number.isSafeInteger(queueNumber) || queueNumber < 1) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo reservar el siguiente número de orden." });
    }

    if (waitlistEntryId) {
      const [offers] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id FROM reservation_waitlist
         WHERE id = ? AND user_id = ? AND service_date = ? AND service = ?
           AND status = 'OFFERED' AND expires_at > UTC_TIMESTAMP()
         FOR UPDATE`,
        [waitlistEntryId, userId, serviceDate, service]
      );
      if (!offers[0] || isDeadlineReached(configuredDeadlineUtc(serviceDate, String(settings[0].presentation_deadline_at)))) {
        throw new TRPCError({ code: "CONFLICT", message: "La oferta de la lista de espera venció o ya no está disponible." });
      }
    }

    const weekStart = startOfWeek(serviceDate);
    const weekEnd = followingWeek(weekStart);
    const [counts] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM reservations
       WHERE user_id = ? AND service_date >= ? AND service_date < ? AND status <> 'CANCELADA'`,
      [userId, weekStart, weekEnd]
    );
    if (waitlistEntryId
      ? Number(counts[0].total) >= 5
      : !canBook(Number(counts[0].total), Number(slot.capacity), Number(slot.booked))) {
      const message = Number(counts[0].total) >= 5
        ? "Ya alcanzaste el máximo de 5 reservas en esa semana."
        : "No quedan cupos disponibles para este servicio.";
      throw new TRPCError({ code: "CONFLICT", message });
    }

    const userRole = String(users[0].role);
    let scholarshipType: string | null = null;
    if (userRole === "ALUMNO") {
      const [scholarships] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT scholarship_type FROM scholarships
         WHERE user_id = ? AND status = 'APROBADA'
           AND (valid_from IS NULL OR valid_from <= ?)
           AND (valid_until IS NULL OR valid_until >= ?)
         ORDER BY valid_from DESC LIMIT 1`,
        [userId, serviceDate, serviceDate]
      );
      scholarshipType = scholarships[0]?.scholarship_type ? String(scholarships[0].scholarship_type) : "SIN_BECA";
    }
    const [prices] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT amount, currency FROM price_history
       WHERE role = ? AND (scholarship_type = ? OR (scholarship_type IS NULL AND ? IS NULL))
         AND valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?)
       ORDER BY valid_from DESC LIMIT 1`,
      [userRole, scholarshipType, scholarshipType, serviceDate, serviceDate]
    );
    if (!prices[0]) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay una tarifa vigente configurada para tu tipo de cuenta." });
    }

    const reservationId = randomUUID();
    const requiresPayment = Number(prices[0].amount) > 0;
    const presentationDeadline = argentinaDeadlineUtc(serviceDate, String(settings[0].presentation_deadline_at));
    await connection.execute(
      `INSERT INTO reservations
       (id, user_id, dni_snapshot, role_snapshot, service_date, service, queue_number, status, approval_status, payment_status,
        price_amount, price_currency, scholarship_type, presentation_deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?)`,
      [
        reservationId, userId, users[0].dni ?? null, userRole, serviceDate, service,
        queueNumber,
        requiresPayment ? "PENDIENTE" : "CONFIRMADA",
        requiresPayment ? "PENDIENTE" : "NO_REQUIERE_PAGO",
        prices[0].amount, prices[0].currency, scholarshipType, presentationDeadline
      ]
    );
    await connection.execute(
      `UPDATE capacity_slots
       SET booked = booked + ?, next_ticket_number = next_ticket_number + 1
       WHERE service_date = ? AND service = ?`,
      [waitlistEntryId ? 0 : 1, serviceDate, service]
    );
    if (waitlistEntryId) {
      const [claimed] = await connection.execute<mysql.ResultSetHeader>(
        `UPDATE reservation_waitlist
         SET status = 'CLAIMED', reservation_id = ?, claimed_at = UTC_TIMESTAMP()
         WHERE id = ? AND user_id = ? AND status = 'OFFERED' AND expires_at > UTC_TIMESTAMP()`,
        [reservationId, waitlistEntryId, userId]
      );
      if (!claimed.affectedRows) {
        throw new TRPCError({ code: "CONFLICT", message: "La oferta de la lista de espera ya no está disponible." });
      }
    }
    await connection.execute(
      "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
      [randomUUID(), userId, "Reserva registrada", `Tu solicitud para ${service.toLowerCase()} del ${serviceDate} quedó pendiente de aprobación.`]
    );
    await writeAudit(connection, {
      actorId: userId, action: "reservation.create", resourceType: "reservation", resourceId: reservationId,
      metadata: {
        status: requiresPayment ? "PENDIENTE" : "CONFIRMADA", approvalStatus: "PENDIENTE",
        priceAmount: Number(prices[0].amount), queueNumber, waitlistEntryId: waitlistEntryId ?? null
      }
    });
    await connection.commit();
    return {
      id: reservationId,
      status: requiresPayment ? "PENDIENTE" : "CONFIRMADA",
      approvalStatus: "PENDIENTE",
      paymentStatus: requiresPayment ? "PENDIENTE" : "NO_REQUIERE_PAGO"
    };
  } catch (error) {
    await connection.rollback();
    if (error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY") {
      throw new TRPCError({ code: "CONFLICT", message: "Ya tenés una reserva para ese servicio y esa fecha." });
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function cancelReservation(userId: string, reservationId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT r.id, r.user_id, r.service_date, r.service, r.status,
              c.booking_closes_at AS bookingClosesAt
       FROM reservations r JOIN service_capacity_config c ON c.service = r.service
       WHERE r.id = ? FOR UPDATE`,
      [reservationId]
    );
    const reservation = rows[0];
    if (!reservation || reservation.user_id !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "No encontramos esa reserva." });
    if (!["PENDIENTE", "CONFIRMADA"].includes(String(reservation.status))) throw new TRPCError({ code: "CONFLICT", message: "La reserva ya no se puede cancelar." });
    const serviceDate = String(reservation.service_date).slice(0, 10);
    const today = argentinaToday();
    const nowTime = argentinaTime();
    if (serviceDate < today) throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede cancelar una reserva pasada." });
    if (!isCancellationAllowed(serviceDate, String(reservation.bookingClosesAt), today, nowTime)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La cancelación solo está disponible hasta el cierre de reservas de este servicio." });
    }

    await connection.execute("UPDATE reservations SET status = 'CANCELADA', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?", [reservationId]);
    await connection.execute("UPDATE tickets SET status = 'CANCELADO' WHERE reservation_id = ?", [reservationId]);
    await connection.execute(
      "UPDATE capacity_slots SET booked = GREATEST(booked - 1, 0) WHERE service_date = ? AND service = ?",
      [String(reservation.service_date).slice(0, 10), reservation.service]
    );
    await promoteWaitlistForSlot(connection, serviceDate, reservation.service as Service);
    await writeAudit(connection, {
      actorId: userId, action: "reservation.cancel", resourceType: "reservation", resourceId: reservationId,
      metadata: { previousStatus: String(reservation.status), newStatus: "CANCELADA" }
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

export async function expireReservations() {
  const [candidates] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT t.id AS ticketId, r.id AS reservationId
     FROM tickets t
     JOIN reservations r ON r.id = t.reservation_id
     LEFT JOIN service_capacity_config c ON c.service = r.service
     WHERE t.status = 'DISPONIBLE'
       AND r.status IN ('PENDIENTE', 'CONFIRMADA')
       AND COALESCE(
         r.presentation_deadline,
         TIMESTAMPADD(HOUR, 3, TIMESTAMP(r.service_date, c.presentation_deadline_at))
       ) <= UTC_TIMESTAMP()
     ORDER BY r.service_date, r.service LIMIT 500`
  );
  let expiredCount = 0;
  for (const candidate of candidates) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [tickets] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT id, reservation_id AS reservationId FROM tickets WHERE id = ? FOR UPDATE",
        [candidate.ticketId]
      );
      if (!tickets[0]) {
        await connection.commit();
        continue;
      }
      const [reservations] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id, user_id AS userId, service_date AS serviceDate, service, status,
                approval_status AS approvalStatus, payment_status AS paymentStatus
         FROM reservations WHERE id = ? FOR UPDATE`,
        [tickets[0].reservationId]
      );
      const reservation = reservations[0];
      if (!reservation || !["PENDIENTE", "CONFIRMADA"].includes(String(reservation.status))) {
        await connection.commit();
        continue;
      }
      const [stillExpired] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT t.id FROM tickets t
         LEFT JOIN service_capacity_config c ON c.service = ?
         WHERE t.id = ? AND t.status = 'DISPONIBLE'
           AND COALESCE(
             (SELECT presentation_deadline FROM reservations WHERE id = ?),
             TIMESTAMPADD(HOUR, 3, TIMESTAMP(?, c.presentation_deadline_at))
           ) <= UTC_TIMESTAMP()`,
        [reservation.service, tickets[0].id, reservation.id, String(reservation.serviceDate).slice(0, 10)]
      );
      if (!stillExpired[0]) {
        await connection.commit();
        continue;
      }
      await connection.execute(
        `UPDATE reservations SET
           no_show_at = CASE
             WHEN status = 'CONFIRMADA' AND approval_status = 'APROBADA'
               AND payment_status IN ('NO_REQUIERE_PAGO', 'PAGADO')
             THEN UTC_TIMESTAMP() ELSE no_show_at
           END,
           status = 'VENCIDA'
         WHERE id = ?`,
        [reservation.id]
      );
      await connection.execute("UPDATE tickets SET status = 'VENCIDO' WHERE id = ?", [tickets[0].id]);
      const serviceDate = String(reservation.serviceDate).slice(0, 10);
      await connection.execute(
        "UPDATE capacity_slots SET booked = GREATEST(booked - 1, 0) WHERE service_date = ? AND service = ?",
        [serviceDate, reservation.service]
      );
      await writeAudit(connection, {
        actorId: null, action: "reservation.expire", resourceType: "reservation", resourceId: String(reservation.id),
        metadata: {
          serviceDate, service: String(reservation.service),
          noShow: reservation.status === "CONFIRMADA" && reservation.approvalStatus === "APROBADA" &&
            ["NO_REQUIERE_PAGO", "PAGADO"].includes(String(reservation.paymentStatus))
        }
      });
      await promoteWaitlistForSlot(connection, serviceDate, reservation.service as Service);
      await connection.commit();
      expiredCount += 1;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  return expiredCount;
}

export async function consumeTicket(ticketId: string, actorId: string) {
  const connection = await pool.getConnection();
  let rejection: TRPCError | undefined;
  let consumed: { service: Service; serviceDate: string } | undefined;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT t.id, t.reservation_id, t.service_date, t.service, t.status, r.status AS reservation_status,
              r.approval_status, r.payment_status,
              r.presentation_deadline AS presentationDeadline
       FROM tickets t JOIN reservations r ON r.id = t.reservation_id
       WHERE t.id = ? FOR UPDATE`,
      [ticketId]
    );
    const ticket = rows[0];
    if (!ticket) {
      await connection.execute(
        "INSERT INTO ticket_scans (id, operator_id, result) VALUES (?, ?, 'INVALID')",
        [randomUUID(), actorId]
      );
      rejection = new TRPCError({ code: "NOT_FOUND", message: "El QR no corresponde a un ticket válido." });
    } else {
      const serviceDate = String(ticket.service_date).slice(0, 10);
      const ticketService = ticket.service === "ALMUERZO" || ticket.service === "CENA" ? ticket.service : null;
      const pastDeadline = isDeadlineReached(ticket.presentationDeadline as Date | string | null) ||
        serviceDate < argentinaToday();
      let scanResult: "ALREADY_USED" | "EXPIRED" | "CANCELLED" | "INVALID" | null = null;
      if (ticket.status === "UTILIZADO") scanResult = "ALREADY_USED";
      else if (ticket.status === "VENCIDO" || pastDeadline) scanResult = "EXPIRED";
      else if (ticket.status === "CANCELADO") scanResult = "CANCELLED";
      else if (!ticketService || ticket.status !== "DISPONIBLE" || ticket.reservation_status !== "CONFIRMADA") scanResult = "INVALID";
      else if (!isTicketEligible(String(ticket.approval_status), String(ticket.payment_status))) scanResult = "INVALID";
      if (scanResult) {
        if (scanResult === "EXPIRED" && ticket.status === "DISPONIBLE") {
          await connection.execute("UPDATE tickets SET status = 'VENCIDO' WHERE id = ?", [ticket.id]);
          await connection.execute("UPDATE reservations SET status = 'VENCIDA' WHERE id = ?", [ticket.reservation_id]);
        }
        await connection.execute(
          "INSERT INTO ticket_scans (id, ticket_id, reservation_id, operator_id, result) VALUES (?, ?, ?, ?, ?)",
          [randomUUID(), ticket.id, ticket.reservation_id, actorId, scanResult]
        );
        rejection = new TRPCError({
          code: scanResult === "EXPIRED" ? "BAD_REQUEST" : "CONFLICT",
          message: scanResult === "ALREADY_USED" ? "El ticket ya fue utilizado."
            : scanResult === "EXPIRED" ? "El ticket está vencido o no corresponde al día de hoy."
              : scanResult === "CANCELLED" ? "El ticket fue cancelado."
                : "El ticket no está activo."
        });
      } else {
        if (!ticketService) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "El ticket tiene un servicio inválido." });
        consumed = { service: ticketService, serviceDate };
        await connection.execute("UPDATE tickets SET status = 'UTILIZADO', consumed_at = CURRENT_TIMESTAMP WHERE id = ?", [ticketId]);
        await connection.execute("UPDATE reservations SET status = 'UTILIZADA' WHERE id = ?", [ticket.reservation_id]);
        await connection.execute(
          "INSERT INTO ticket_scans (id, ticket_id, reservation_id, operator_id, result) VALUES (?, ?, ?, ?, 'VALID')",
          [randomUUID(), ticket.id, ticket.reservation_id, actorId]
        );
        await writeAudit(connection, {
          actorId, action: "ticket.consume", resourceType: "ticket", resourceId: ticketId,
          metadata: { reservationId: String(ticket.reservation_id), previousStatus: "DISPONIBLE", newStatus: "UTILIZADO" }
        });
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (rejection) throw rejection;
  if (!consumed) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo registrar el uso del ticket." });
  return { success: true as const, ...consumed };
}

import type * as mysql from "mysql2";
