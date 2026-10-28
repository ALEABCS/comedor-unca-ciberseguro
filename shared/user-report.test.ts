import { describe, expect, it } from "vitest";
import { summarizeUserReport } from "./user-report";

describe("summarizeUserReport", () => {
  it("counts students by scholarship and other account profiles without duplicating rows", () => {
    const summary = summarizeUserReport([
      { role: "ALUMNO", scholarshipType: "SIN_BECA" },
      { role: "ALUMNO", scholarshipType: "MEDIA_BECA" },
      { role: "ALUMNO", scholarshipType: "BECA_COMPLETA" },
      { role: "DOCENTE", scholarshipType: null },
      { role: "NO_DOCENTE", scholarshipType: null },
      { role: "INVITADO_ESPECIAL", scholarshipType: null }
    ]);
    expect(summary.total).toBe(6);
    expect(summary.categories).toEqual({
      ALUMNO_SIN_BECA: 1,
      ALUMNO_MEDIA_BECA: 1,
      ALUMNO_BECA_COMPLETA: 1,
      DOCENTE: 1,
      NO_DOCENTE: 1,
      INVITADO_ESPECIAL: 1,
      ADMINISTRADOR_LOCAL: 0,
      SUPERVISOR: 0
    });
  });
});
