export const initialPrices = [
  ["ALUMNO", "BECA_COMPLETA", "0.00"],
  ["ALUMNO", "MEDIA_BECA", "1500.00"],
  ["ALUMNO", "SIN_BECA", "3000.00"],
  ["DOCENTE", null, "4500.00"],
  ["NO_DOCENTE", null, "4500.00"],
  ["INVITADO_ESPECIAL", null, "5000.00"]
] as const;

export const demoLoginAccounts = [
  {
    id: "10000000-0000-4000-8000-000000000007",
    username: "comedor",
    password: "comedor123",
    email: "comedor@demo.comedor-unca.invalid",
    firstName: "Admin",
    lastName: "Local",
    role: "ADMINISTRADOR_LOCAL"
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    username: "supervisor",
    password: "supervisor123",
    email: "supervisor@demo.comedor-unca.invalid",
    firstName: "Supervisión",
    lastName: "Demo",
    role: "SUPERVISOR"
  }
] as const;

export function demoLoginAccountsForMode(enabled: boolean) {
  return enabled ? demoLoginAccounts : [];
}
