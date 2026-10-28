import { createHash } from "node:crypto";

export type FoodCreditStatus = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "UTILIZADA" | "VENCIDA";

export function isEligibleFoodCreditStudent(role: string, scholarshipType?: string | null): boolean {
  return role === "ALUMNO" && (scholarshipType == null || scholarshipType === "SIN_BECA" || scholarshipType === "MEDIA_BECA");
}

export function createFoodCreditKey(reservationId: string, service: string): string {
  return createHash("sha256")
    .update(`${reservationId}:${service}:food-credit`)
    .digest("hex")
    .slice(0, 64);
}
