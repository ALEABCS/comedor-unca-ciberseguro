import { describe, expect, it } from "vitest";
import { createFoodCreditKey, isEligibleFoodCreditStudent } from "./food-credits";

describe("food credit eligibility", () => {
  it("allows only eligible student profiles", () => {
    expect(isEligibleFoodCreditStudent("ALUMNO", "SIN_BECA")).toBe(true);
    expect(isEligibleFoodCreditStudent("ALUMNO", "MEDIA_BECA")).toBe(true);
    expect(isEligibleFoodCreditStudent("ALUMNO", "BECA_COMPLETA")).toBe(false);
    expect(isEligibleFoodCreditStudent("DOCENTE", "SIN_BECA")).toBe(false);
    expect(isEligibleFoodCreditStudent("NO_DOCENTE", "MEDIA_BECA")).toBe(false);
    expect(isEligibleFoodCreditStudent("INVITADO_ESPECIAL", "MEDIA_BECA")).toBe(false);
  });

  it("uses one stable key per reservation and meal", () => {
    const keyA = createFoodCreditKey("reservation-1", "meal-2");
    const keyB = createFoodCreditKey("reservation-1", "meal-2");
    const keyC = createFoodCreditKey("reservation-1", "meal-3");

    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });
});
