import { describe, expect, it } from "vitest";
import { canViewEventsNewsEntry } from "./events-news";
import type { Role } from "./domain";

const communityRoles: Role[] = ["ALUMNO", "DOCENTE", "NO_DOCENTE"];

describe("events and news visibility", () => {
  it.each(communityRoles)("allows %s to see only published public entries", (role) => {
    const user = { role, isDemo: false, twoFactorVerified: false };

    expect(canViewEventsNewsEntry({ ...user, published: true, visibility: "PUBLICO" })).toBe(true);
    expect(canViewEventsNewsEntry({ ...user, published: true, visibility: "PRIVADO" })).toBe(false);
    expect(canViewEventsNewsEntry({ ...user, published: false, visibility: "PUBLICO" })).toBe(false);
    expect(canViewEventsNewsEntry({ ...user, published: false, visibility: "PRIVADO" })).toBe(false);
  });

  it("allows the local administrator and supervisor to view published private reports", () => {
    for (const role of ["ADMINISTRADOR_LOCAL", "SUPERVISOR"] as const) {
      expect(canViewEventsNewsEntry({
        role, isDemo: false, twoFactorVerified: true, published: true, visibility: "PRIVADO"
      })).toBe(true);
    }
  });

  it("limits unpublished drafts to the verified non-demo local administrator", () => {
    expect(canViewEventsNewsEntry({
      role: "ADMINISTRADOR_LOCAL", isDemo: false, twoFactorVerified: true, published: false, visibility: "PRIVADO"
    })).toBe(true);
    expect(canViewEventsNewsEntry({
      role: "SUPERVISOR", isDemo: false, twoFactorVerified: true, published: false, visibility: "PRIVADO"
    })).toBe(false);
    expect(canViewEventsNewsEntry({
      role: "ADMINISTRADOR_LOCAL", isDemo: true, twoFactorVerified: true, published: false, visibility: "PRIVADO"
    })).toBe(false);
    expect(canViewEventsNewsEntry({
      role: "ADMINISTRADOR_LOCAL", isDemo: false, twoFactorVerified: false, published: true, visibility: "PRIVADO"
    })).toBe(false);
  });
});
