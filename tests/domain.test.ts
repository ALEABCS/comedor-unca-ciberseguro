import { describe, expect, it } from "vitest";
import { assignableRolesForActor, canAccessFoodCredits, canBook, configuredDeadlineUtc, formatDeadlineCountdown, formatTicketIdentifier, hasPermission, isCancellationAllowed, isDeadlineReached, isReservationDateAllowed, isWithinBookingWindow, startOfWeek } from "../shared/domain";
import { createQrPayload, verifyQrPayload } from "../server/security/qr";
import { hashPassword, verifyPassword } from "../server/auth/password";
import { demoLoginAccounts, demoLoginAccountsForMode, initialPrices } from "../server/db/seed-data";
import { validateSigningSecrets } from "../server/security/secrets";

describe("reglas de reserva", () => {
  it("calcula la semana empezando el lunes", () => {
    expect(startOfWeek("2026-09-30")).toBe("2026-09-28");
    expect(startOfWeek("2026-09-28")).toBe("2026-09-28");
  });

  describe("vencimiento de reservas", () => {
    it("expira exactamente en la fecha límite y muestra el tiempo restante", () => {
      const deadline = "2026-10-01T16:00:00.000Z";
      const beforeDeadline = Date.parse("2026-10-01T15:59:59.000Z");
      expect(isDeadlineReached(deadline, beforeDeadline)).toBe(false);
      expect(isDeadlineReached(deadline, Date.parse(deadline))).toBe(true);
      expect(formatDeadlineCountdown(deadline, beforeDeadline)).toEqual({ expired: false, label: "1 s" });
      expect(formatDeadlineCountdown(deadline, Date.parse(deadline))).toEqual({ expired: true, label: "Plazo vencido" });
    });

    it("calcula el límite local configurado en hora UTC para registros existentes", () => {
      expect(configuredDeadlineUtc("2026-10-01", "13:00").toISOString()).toBe("2026-10-01T16:00:00.000Z");
    });
  });

  describe("datos iniciales seguros", () => {
    it("mantiene las tarifas estudiantiles definidas por la especificación", () => {
      expect(initialPrices.slice(0, 3)).toEqual([
        ["ALUMNO", "BECA_COMPLETA", "0.00"],
        ["ALUMNO", "MEDIA_BECA", "1500.00"],
        ["ALUMNO", "SIN_BECA", "3000.00"]
      ]);
      expect(initialPrices.slice(3)).toEqual([
        ["DOCENTE", null, "4500.00"],
        ["NO_DOCENTE", null, "4500.00"],
        ["INVITADO_ESPECIAL", null, "5000.00"]
      ]);
    });

    it("solo expone los usuarios de acceso rápido dentro del modo demo", () => {
      expect(demoLoginAccountsForMode(false)).toEqual([]);
      expect(demoLoginAccountsForMode(true)).toEqual(demoLoginAccounts);
      expect(demoLoginAccounts.map(({ username, password, role }) => [username, password, role])).toEqual([
        ["comedor", "comedor123", "ADMINISTRADOR_LOCAL"],
        ["supervisor", "supervisor123", "SUPERVISOR"]
      ]);
    });
  });

  it("no permite fechas pasadas ni calendarios malformados", () => {
    expect(isReservationDateAllowed("2026-09-30", "2026-09-30")).toBe(true);
    expect(isReservationDateAllowed("2026-09-29", "2026-09-30")).toBe(false);
    expect(isReservationDateAllowed("30-09-2026", "2026-09-30")).toBe(false);
    expect(isReservationDateAllowed("2026-02-30", "2026-02-01")).toBe(false);
  });

  it("aplica límites semanal y de capacidad de forma independiente", () => {
    expect(canBook(4, 750, 749)).toBe(true);
    expect(canBook(5, 750, 749)).toBe(false);
    expect(canBook(4, 750, 750)).toBe(false);
    expect(canBook(4, 750, 751)).toBe(false);
  });

  it("aplica ventanas de reserva independientes y cierre exclusivo", () => {
    expect(isWithinBookingWindow("08:00", "08:00", "11:00")).toBe(true);
    expect(isWithinBookingWindow("10:59", "08:00", "11:00")).toBe(true);
    expect(isWithinBookingWindow("11:00", "08:00", "11:00")).toBe(false);
    expect(isWithinBookingWindow("18:00", "18:00", "22:00")).toBe(true);
  });

  it("permite cancelar hasta el cierre del día del servicio y antes para fechas futuras", () => {
    expect(isCancellationAllowed("2026-10-01", "11:00", "2026-10-01", "10:59")).toBe(true);
    expect(isCancellationAllowed("2026-10-01", "11:00", "2026-10-01", "11:00")).toBe(false);
    expect(isCancellationAllowed("2026-10-02", "11:00", "2026-10-01", "18:00")).toBe(true);
    expect(isCancellationAllowed("2026-09-30", "11:00", "2026-10-01", "10:00")).toBe(false);
    expect(isCancellationAllowed("2026-10-02", "99:99", "2026-10-01", "10:00")).toBe(false);
  });

  it("genera identificadores de ticket con fecha, correlativo y servicio", () => {
    expect(formatTicketIdentifier("2027-04-09", "ALMUERZO", 12)).toBe("12-9-4-2027-A");
    expect(formatTicketIdentifier("2027-04-09", "CENA", 3)).toBe("3-9-4-2027-C");
  });
});

describe("permisos por rol", () => {
  it("restringe la administración de cuentas y permite supervisión operativa", () => {
    expect(hasPermission("ALUMNO", "menu:read")).toBe(true);
    expect(hasPermission("ALUMNO", "tickets:validate")).toBe(false);
    expect(hasPermission("SUPERVISOR", "audit:read")).toBe(true);
    expect(hasPermission("SUPERVISOR", "menu:manage")).toBe(false);
    expect(hasPermission("ADMINISTRADOR_LOCAL", "menu:manage")).toBe(true);
    expect(hasPermission("SUPERVISOR", "reservations:approve")).toBe(true);
    expect(hasPermission("ADMINISTRADOR_LOCAL", "reservations:approve")).toBe(true);
    expect(hasPermission("ALUMNO", "users:manage")).toBe(false);
    expect(hasPermission("ALUMNO", "payments:manage")).toBe(false);
    expect(hasPermission("ADMINISTRADOR_LOCAL", "payments:manage")).toBe(true);
    expect(hasPermission("SUPERVISOR", "payments:manage")).toBe(true);
    expect(hasPermission("ADMINISTRADOR_LOCAL", "tickets:validate")).toBe(true);
  });

  it("limits local administrators to ordinary roles while supervisors may assign any role", () => {
    expect(assignableRolesForActor("ADMINISTRADOR_LOCAL")).toEqual([
      "ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL"
    ]);
    expect(assignableRolesForActor("SUPERVISOR")).toContain("ADMINISTRADOR_LOCAL");
    expect(assignableRolesForActor("SUPERVISOR")).toContain("SUPERVISOR");
    expect(assignableRolesForActor("ALUMNO")).toEqual([]);
  });

  it("limits food credits to students and their supervisor", () => {
    expect(canAccessFoodCredits("ALUMNO")).toBe(true);
    expect(canAccessFoodCredits("SUPERVISOR")).toBe(true);
    expect(canAccessFoodCredits("DOCENTE")).toBe(false);
    expect(canAccessFoodCredits("NO_DOCENTE")).toBe(false);
    expect(canAccessFoodCredits("INVITADO_ESPECIAL")).toBe(false);
    expect(canAccessFoodCredits("ADMINISTRADOR_LOCAL")).toBe(false);
  });
});

describe("contraseñas locales", () => {
  it("hashea con sal y verifica sin comparar secretos en texto plano", async () => {
    const password = "clave-de-prueba-segura";
    const encoded = await hashPassword(password);
    expect(encoded).not.toContain(password);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword("otra-clave", encoded)).toBe(false);
    expect(await verifyPassword(password, "invalid$hash")).toBe(false);
  });
});

describe("firma QR", () => {
  const ticketId = "10000000-0000-4000-8000-000000000001";

  it("firma identificadores y detecta payloads manipulados", () => {
    const payload = createQrPayload(ticketId);
    expect(verifyQrPayload(payload)).toBe(ticketId);
    expect(verifyQrPayload(`${payload.slice(0, -1)}x`)).toBeNull();
    expect(verifyQrPayload("unca:ticket:invalid")).toBeNull();
  });

  describe("secretos de firma", () => {
    const sessionSecret = "a".repeat(64);
    const qrSecret = "b".repeat(64);
    const totpSecret = "c".repeat(64);

    it("requiere secretos suficientemente largos y diferentes", () => {
      expect(() => validateSigningSecrets(sessionSecret, qrSecret)).not.toThrow();
      expect(() => validateSigningSecrets(sessionSecret, qrSecret, totpSecret)).not.toThrow();
      expect(() => validateSigningSecrets("short", qrSecret)).toThrow(/32 caracteres aleatorios/);
      expect(() => validateSigningSecrets("replace-with-a-long-placeholder-secret", qrSecret))
        .toThrow(/32 caracteres aleatorios/);
      expect(() => validateSigningSecrets(sessionSecret, sessionSecret)).toThrow(/deben ser diferentes/);
      expect(() => validateSigningSecrets(sessionSecret, qrSecret, sessionSecret)).toThrow(/distinto/);
    });
  });
});
