import { describe, expect, it } from "vitest";
import { createContext, permissionProcedure, protectedProcedure, router } from "./trpc";

describe("createContext", () => {
  it("keeps the authenticated user safe even when the session is missing", () => {
    const req = {
      user: {
        id: "user-1",
        email: "empleado@unca.edu.ar",
        dni: "12345678",
        phone: null,
        firstName: "Ana",
        lastName: "García",
        role: "ALUMNO",
        status: "ACTIVE",
        isDemo: false,
        twoFactorEnabled: false,
        twoFactorVerified: false
      },
      session: undefined
    } as any;

    const context = createContext({
      req,
      res: { getHeader: () => "req-42" } as any,
      info: {} as any
    });

    expect(context.user).not.toBeNull();
    expect(context.user?.twoFactorVerified).toBe(false);
    expect(context.requestId).toBe("req-42");
  });
});

describe("pending Google guest access", () => {
  const pendingGuestRouter = router({
    read: protectedProcedure.query(({ ctx }) => ctx.user.status),
    write: protectedProcedure.mutation(({ ctx }) => ctx.user.status),
    reserve: permissionProcedure("reservations:create").mutation(({ ctx }) => ctx.user.status)
  });

  it("allows pending guests to use the app but blocks reservation mutations", async () => {
    const caller = pendingGuestRouter.createCaller({
      user: {
        id: "guest-1", email: "guest@example.invalid", dni: null, phone: null,
        firstName: "Guest", lastName: "User", role: "INVITADO_ESPECIAL",
        status: "PENDING", isDemo: false, twoFactorEnabled: false, twoFactorVerified: false
      },
      req: {} as any,
      requestId: "req-guest"
    });

    await expect(caller.read()).resolves.toBe("PENDING");
    await expect(caller.write()).resolves.toBe("PENDING");
    await expect(caller.reserve()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not allow pending non-guest accounts into the app", async () => {
    const caller = pendingGuestRouter.createCaller({
      user: {
        id: "student-1", email: "student@example.invalid", dni: null, phone: null,
        firstName: "Pending", lastName: "Student", role: "ALUMNO",
        status: "PENDING", isDemo: false, twoFactorEnabled: false, twoFactorVerified: false
      },
      req: {} as any,
      requestId: "req-pending"
    });

    await expect(caller.read()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows an approved invited guest to reserve", async () => {
    const caller = pendingGuestRouter.createCaller({
      user: {
        id: "guest-2", email: "approved@example.invalid", dni: null, phone: null,
        firstName: "Approved", lastName: "Guest", role: "INVITADO_ESPECIAL",
        status: "ACTIVE", isDemo: false, twoFactorEnabled: false, twoFactorVerified: false
      },
      req: {} as any,
      requestId: "req-approved"
    });

    await expect(caller.reserve()).resolves.toBe("ACTIVE");
  });
});

describe("supervisor-only security access", () => {
  const securityRouter = router({
    overview: permissionProcedure("audit:read").query(({ ctx }) => ({ role: ctx.user.role }))
  });

  it.each([
    "ALUMNO",
    "DOCENTE",
    "NO_DOCENTE",
    "INVITADO_ESPECIAL",
    "ADMINISTRADOR_LOCAL"
  ] as const)("denies %s access to security data", async (role) => {
    const caller = securityRouter.createCaller({
      user: {
        id: "user-1", email: "user@example.invalid", dni: null, phone: null,
        firstName: "Test", lastName: "User", role,
        status: "ACTIVE", isDemo: false,
        twoFactorEnabled: role === "ADMINISTRADOR_LOCAL",
        twoFactorVerified: role === "ADMINISTRADOR_LOCAL"
      },
      req: {} as any,
      requestId: "req-security"
    });

    await expect(caller.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a verified supervisor to access security data", async () => {
    const caller = securityRouter.createCaller({
      user: {
        id: "supervisor-1", email: "supervisor@example.invalid", dni: null, phone: null,
        firstName: "Supervisor", lastName: "Test", role: "SUPERVISOR",
        status: "ACTIVE", isDemo: false, twoFactorEnabled: true, twoFactorVerified: true
      },
      req: {} as any,
      requestId: "req-security"
    });

    await expect(caller.overview()).resolves.toEqual({ role: "SUPERVISOR" });
  });
});
