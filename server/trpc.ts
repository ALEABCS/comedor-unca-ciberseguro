import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Permission, Role } from "../shared/domain";
import { permissions } from "../shared/domain";

export type AuthUser = {
  id: string;
  email: string;
  dni: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  isDemo: boolean;
  twoFactorEnabled: boolean;
  twoFactorVerified: boolean;
};

export type Context = { user: AuthUser | null; req: CreateExpressContextOptions["req"]; requestId: string };

export function createContext({ req, res }: CreateExpressContextOptions): Context {
  const session = "session" in req ? req.session : undefined;
  return {
    user: req.user
      ? { ...(req.user as AuthUser), twoFactorVerified: session?.twoFactorVerified === true }
      : null,
    req,
    requestId: String(res.getHeader("X-Request-ID") ?? "")
  };
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error, ctx }) {
    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR"
        ? "Ocurrió un error inesperado. Intentá nuevamente."
        : shape.message,
      data: {
        ...shape.data,
        stack: undefined,
        requestId: ctx?.requestId || undefined
      }
    };
  }
});
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const pendingGuest = ctx.user?.status === "PENDING" && ctx.user.role === "INVITADO_ESPECIAL";
  if (!ctx.user || (ctx.user.status !== "ACTIVE" && !pendingGuest)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Iniciá sesión para continuar." });
  }
  if (["ADMINISTRADOR_LOCAL", "SUPERVISOR"].includes(ctx.user.role) &&
      (!ctx.user.twoFactorEnabled || !ctx.user.twoFactorVerified)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Configurá la verificación en dos pasos para continuar." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const permissionProcedure = (permission: Permission) => protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.status === "PENDING" && ctx.user.role === "INVITADO_ESPECIAL" &&
      ["reservations:create", "reservations:cancel:own"].includes(permission)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tu cuenta invitada está pendiente de aprobación. Un Supervisor o Administrador Local debe habilitar tus reservas." });
  }
  if (!(permissions[permission] as readonly string[]).includes(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenés permiso para realizar esta acción." });
  }
  return next({ ctx });
});
