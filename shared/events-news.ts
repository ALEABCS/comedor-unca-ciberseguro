import type { Role } from "./domain";

export type EventsNewsVisibility = "PUBLICO" | "PRIVADO";

export function canViewEventsNewsEntry({
  role,
  isDemo,
  twoFactorVerified,
  published,
  visibility
}: {
  role: Role;
  isDemo: boolean;
  twoFactorVerified: boolean;
  published: boolean;
  visibility: EventsNewsVisibility;
}): boolean {
  if (!published) {
    return role === "ADMINISTRADOR_LOCAL" && !isDemo && twoFactorVerified;
  }
  if (visibility === "PUBLICO") return true;
  return ["ADMINISTRADOR_LOCAL", "SUPERVISOR"].includes(role) && !isDemo && twoFactorVerified;
}
