import type { Role } from "../../shared/domain";

const privilegedGoogleRoles: Record<string, Role> = {
  "jolas@unca.edu.ar": "SUPERVISOR",
  "pmolina@unca.edu.ar": "ADMINISTRADOR_LOCAL"
};

export function privilegedGoogleRoleForEmail(email: string): Role | null {
  return privilegedGoogleRoles[email.trim().toLowerCase()] ?? null;
}

export function isGoogleAccountLinkedToSubject(
  accountGoogleSubject: string | null,
  profileGoogleSubject: string
): boolean {
  return accountGoogleSubject === profileGoogleSubject;
}

export function shouldMigratePendingGoogleStudent(
  account: { role: string; status: string; googleSubject: string | null },
  googleSubject: string
): boolean {
  return account.status === "PENDING" &&
    account.role === "ALUMNO" &&
    account.googleSubject === googleSubject;
}