import { describe, expect, it } from "vitest";
import { isInstitutionalBusinessDay, isTicketEligible } from "./domain";

describe("isInstitutionalBusinessDay", () => {
  it("allows Monday through Friday", () => {
    for (const date of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) {
      expect(isInstitutionalBusinessDay(date)).toBe(true);
    }
  });

  it("rejects weekends and invalid calendar dates", () => {
    expect(isInstitutionalBusinessDay("2026-10-24")).toBe(false);
    expect(isInstitutionalBusinessDay("2026-10-25")).toBe(false);
    expect(isInstitutionalBusinessDay("2026-02-30")).toBe(false);
  });
});

describe("isTicketEligible", () => {
  it("requires approval and resolved payment", () => {
    expect(isTicketEligible("APROBADA", "PAGADO")).toBe(true);
    expect(isTicketEligible("APROBADA", "NO_REQUIERE_PAGO")).toBe(true);
    expect(isTicketEligible("PENDIENTE", "PAGADO")).toBe(false);
    expect(isTicketEligible("APROBADA", "PENDIENTE")).toBe(false);
    expect(isTicketEligible("APROBADA", "RECHAZADO")).toBe(false);
  });
});
