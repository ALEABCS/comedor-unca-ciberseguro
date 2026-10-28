import { describe, expect, it } from "vitest";
import { buildSecurityEventFeed } from "./event-bus";

describe("security event bus", () => {
  it("creates a readable event feed from failed login and session activity", () => {
    const events = buildSecurityEventFeed([
      {
        id: "evt-1",
        action: "MFA_LOGIN_FAILED",
        createdAt: "2026-10-03T12:00:00.000Z",
        resourceType: "auth",
        email: "empleado@unca.edu.ar",
        actorRole: "ADMINISTRADOR_LOCAL",
        metadata: { reason: "empleado@unca.edu.ar used password example" }
      },
      {
        id: "evt-2",
        action: "session.revoke_others",
        createdAt: "2026-10-03T12:05:00.000Z",
        resourceType: "session",
        email: "supervisor@unca.edu.ar",
        actorRole: "SUPERVISOR",
        metadata: { reason: "Suspicious access" }
      }
    ]);

    expect(events).toHaveLength(2);
    expect(events[0].title).toContain("Intento de acceso fallido");
    expect(events[0].actor).toBe("Intento de acceso no identificado");
    expect(events[0].description).not.toContain("empleado@unca.edu.ar");
    expect(events[0].description).not.toContain("password example");
    expect(events[1].topic).toBe("SESSION");
    expect(events[1].severity).toBe("MEDIUM");
  });

  it("classifies and redacts failed local login events", () => {
    const [event] = buildSecurityEventFeed([{
      id: "evt-login",
      action: "login.failed",
      createdAt: "2026-10-03T12:00:00.000Z",
      resourceType: "authentication",
      email: "private@example.invalid",
      metadata: { knownAccount: true, reason: "private@example.invalid" }
    }]);

    expect(event.topic).toBe("AUTH");
    expect(event.severity).toBe("HIGH");
    expect(event.actor).toBe("Intento de acceso no identificado");
    expect(event.description).not.toContain("private@example.invalid");
  });

  it("keeps the event feed stable when metadata is absent", () => {
    const events = buildSecurityEventFeed([
      {
        id: "evt-3",
        action: "incident.create",
        createdAt: "2026-10-03T12:15:00.000Z",
        resourceType: "incident",
        email: null,
        actorRole: "SUPERVISOR",
        metadata: null
      }
    ]);

    expect(events[0].title).toContain("incidente");
    expect(events[0].actor).toBe("Sistema • SUPERVISOR");
  });
});
