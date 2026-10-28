export type UserReportCategory =
  | "ALUMNO_SIN_BECA"
  | "ALUMNO_MEDIA_BECA"
  | "ALUMNO_BECA_COMPLETA"
  | "DOCENTE"
  | "NO_DOCENTE"
  | "INVITADO_ESPECIAL"
  | "ADMINISTRADOR_LOCAL"
  | "SUPERVISOR";

export type UserReportRow = {
  role: string;
  scholarshipType: string | null;
};

export const userReportCategoryLabels: Record<UserReportCategory, string> = {
  ALUMNO_SIN_BECA: "Alumnos sin beca",
  ALUMNO_MEDIA_BECA: "Alumnos con media beca",
  ALUMNO_BECA_COMPLETA: "Alumnos con beca completa",
  DOCENTE: "Docentes",
  NO_DOCENTE: "No docentes",
  INVITADO_ESPECIAL: "Invitados",
  ADMINISTRADOR_LOCAL: "Administradores locales",
  SUPERVISOR: "Supervisores"
};

export function summarizeUserReport(rows: readonly UserReportRow[]) {
  const categories = Object.fromEntries(
    Object.keys(userReportCategoryLabels).map((category) => [category, 0])
  ) as Record<UserReportCategory, number>;

  for (const row of rows) {
    let category: UserReportCategory;
    if (row.role === "ALUMNO") {
      category = row.scholarshipType === "BECA_COMPLETA" ? "ALUMNO_BECA_COMPLETA"
        : row.scholarshipType === "MEDIA_BECA" ? "ALUMNO_MEDIA_BECA" : "ALUMNO_SIN_BECA";
    } else if (row.role === "DOCENTE" || row.role === "NO_DOCENTE" ||
        row.role === "INVITADO_ESPECIAL" || row.role === "ADMINISTRADOR_LOCAL" ||
        row.role === "SUPERVISOR") {
      category = row.role;
    } else {
      throw new Error(`Perfil no reconocido en el informe: ${row.role}`);
    }
    categories[category] += 1;
  }

  return { total: rows.length, categories };
}
