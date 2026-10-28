import "dotenv/config";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import express from "express";
import packageJson from "../package.json";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { z } from "zod";
import { config, featureFlags, isDemoMode, isGuestDemoMode } from "./config";
import { pool } from "./db";
import { appRouter } from "./routers";
import { createContext } from "./trpc";
import passport from "./auth/passport";
import { consumeOAuthState, getOAuthStartRedirect, issueOAuthState } from "./auth/oauth-state";
import { sessionStore } from "./db/session-store";
import { hashPassword, verifyPassword } from "./auth/password";
import {
  createRecoveryCodes, createTotpSecret, createTotpUri, decryptTotpSecret,
  encryptTotpSecret, hashRecoveryCode, matchesRecoveryCode, verifyTotp
} from "./auth/totp";
import { writeAudit } from "./db/audit";
import { expireReservations } from "./domain/reservations";
import { expireWaitlistOffers } from "./domain/waitlist";
import { hasPermission, roles, type Role } from "../shared/domain";
import { paymentMethodValues } from "../shared/payment-methods";
import { moneyCentsToDecimal, parseMoneyToCents, sumMoneyToCents } from "../shared/finance";
import { canViewEventsNewsEntry } from "../shared/events-news";
import type { AuthUser } from "./trpc";

const app = express();

type WeatherSnapshot = {
  location: { name: string; region: string | null; country: string; latitude: number; longitude: number };
  current: {
    temperatureC: number;
    feelsLikeC: number;
    humidityPercent: number;
    windKmh: number;
    weatherCode: number;
    precipitationProbabilityPercent: number | null;
    observedAt: string;
  };
  fetchedAt: string;
  source: "Open-Meteo";
};

const weatherCache = new Map<string, { snapshot: WeatherSnapshot; expiresAt: number }>();
const weatherCacheLifetimeMs = 5 * 60 * 1000;

async function rollbackSafely(connection: Awaited<ReturnType<typeof pool.getConnection>>, operation: string): Promise<boolean> {
  try {
    await connection.rollback();
    return true;
  } catch (error) {
    connection.destroy();
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    console.error(JSON.stringify({
      level: "ERROR", event: "transaction_rollback_failed", operation,
      errorType: error instanceof Error ? error.name : "UnknownError", code
    }));
    return false;
  }
}

app.disable("x-powered-by");
app.set("trust proxy", config.NODE_ENV === "production" ? 1 : false);
app.use((_req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});
app.use((req, res, next) => {
  const socket = req.socket;
  const handleSocketError = (error: NodeJS.ErrnoException) => {
    if (error.code === "ECONNRESET" || error.code === "EPIPE") return;
    console.error(JSON.stringify({
      level: "ERROR", event: "client_socket_error", errorType: error.name, code: error.code ?? "UNKNOWN"
    }));
  };
  socket.once("error", handleSocketError);
  res.once("finish", () => socket.off("error", handleSocketError));
  next();
});
app.use(helmet({
  contentSecurityPolicy: config.NODE_ENV === "production" ? {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'"], objectSrc: ["'none'"],
      frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"]
    }
  } : false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: (origin, callback) => {
    callback(null, origin && isAllowedOrigin(origin) ? origin : false);
  },
  credentials: true
}));
app.use(express.json({ limit: "64kb" }));
app.use(session({
  name: "unca.sid",
  secret: config.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use((req, _res, next) => {
  const user = req.user as AuthUser | undefined;
  if (user) {
    const agent = req.get("user-agent") ?? "";
    const address = req.ip ?? "";
    const normalizedAddress = address.startsWith("::ffff:") ? address.slice(7) : address;
    const ipv4 = normalizedAddress.match(/^(?:\d{1,3}\.){3}\d{1,3}$/);
    const ipv6Prefix = normalizedAddress.split("::")[0]?.split(":").filter(Boolean).slice(0, 4).join(":") ?? "";
    const device = /Android|iPhone|iPad|Mobile/i.test(agent)
      ? "Móvil"
      : /Windows/i.test(agent)
        ? "Windows"
        : /Macintosh|Mac OS/i.test(agent)
          ? "Mac"
          : /Linux/i.test(agent)
            ? "Linux"
            : "Dispositivo";
    const browser = /Edg\//i.test(agent)
      ? "Edge"
      : /Firefox\//i.test(agent)
        ? "Firefox"
        : /Chrome\//i.test(agent)
          ? "Chrome"
          : /Safari\//i.test(agent)
            ? "Safari"
            : "Navegador";
    req.session.sessionDevice = `${device} · ${browser}`;
    req.session.sessionUserAgent = agent.slice(0, 500);
    req.session.sessionIpPartial = ipv4
      ? `${normalizedAddress.split(".").slice(0, 3).join(".")}.0/24`
      : normalizedAddress === "::1"
        ? "IPv6 local"
        : ipv6Prefix
          ? `${ipv6Prefix}::/64`
          : "No disponible";
    req.session.sessionCreatedAt ??= new Date().toISOString();
    req.session.sessionLastActivityAt = new Date().toISOString();
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Esperá unos minutos antes de volver a intentar." }
});
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const ticketValidationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const cashReceiptVerificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Esperá unos minutos antes de volver a intentar." }
});
const carouselUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Se alcanzó el límite temporal de cargas de fotos." }
});
const profilePhotoUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const weatherLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Se alcanzó el límite temporal de consultas meteorológicas. Intentá nuevamente más tarde." }
});

const privilegedRoles: Role[] = ["ADMINISTRADOR_LOCAL", "SUPERVISOR"];
const twoFactorPendingLifetimeMs = 10 * 60 * 1000;

function saveSession(req: express.Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

function regenerateSession(req: express.Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
}

function loginUser(req: express.Request, user: AuthUser): Promise<void> {
  return new Promise((resolve, reject) => req.logIn(user, (error) => error ? reject(error) : resolve()));
}

function toAuthUser(row: import("mysql2").RowDataPacket): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    dni: row.dni ? String(row.dni) : null,
    phone: row.phone ? String(row.phone) : null,
    firstName: String(row.firstName),
    lastName: String(row.lastName),
    role: row.role as Role,
    status: row.status,
    isDemo: Boolean(row.isDemo),
    twoFactorEnabled: Boolean(row.twoFactorEnabled),
    twoFactorVerified: false
  };
}

async function getMfaUser(userId: string) {
  const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
    `SELECT id, email, role, status, totp_secret AS totpSecret, totp_enabled_at AS totpEnabledAt,
            totp_last_used_step AS totpLastUsedStep, totp_recovery_codes AS totpRecoveryCodes
     FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0];
}

function mfaUserId(req: express.Request): string | null {
  const sessionUserId = req.session.pendingTwoFactorUserId;
  if (sessionUserId) return sessionUserId;
  const user = req.user as AuthUser | undefined;
  return user && privilegedRoles.includes(user.role) ? user.id : null;
}

async function beginTwoFactorChallenge(req: express.Request, userId: string): Promise<void> {
  await regenerateSession(req);
  req.session.pendingTwoFactorUserId = userId;
  await saveSession(req);
}

async function completeAuthentication(req: express.Request, user: AuthUser): Promise<void> {
  await regenerateSession(req);
  await loginUser(req, user);
  req.session.twoFactorVerified = privilegedRoles.includes(user.role) && user.twoFactorEnabled;
  if (req.session.twoFactorVerified) await saveSession(req);
}

app.get("/auth/google", authLimiter, (req, res, next) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    return res.status(503).send("Google OAuth todavía no está configurado.");
  }
  const requestOrigin = req.get("origin") ?? req.get("referer") ?? req.get("x-forwarded-host") ?? req.hostname;
  const canonicalLoginUrl = getOAuthStartRedirect(requestOrigin, config.APP_URL);
  if (canonicalLoginUrl) return res.redirect(302, canonicalLoginUrl);
  const issued = issueOAuthState(req.session.oauthStates);
  req.session.oauthStates = issued.states;
  req.session.save((error) => {
    if (error) return next(error);
    passport.authenticate("google", { scope: ["profile", "email"], state: issued.state })(req, res, next);
  });
});
app.get("/auth/google/callback", authLimiter, (req, res, next) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    return res.status(503).send("Google OAuth todavía no está configurado.");
  }
  const actualState = typeof req.query.state === "string" ? req.query.state : "";
  const consumed = consumeOAuthState(req.session.oauthStates, actualState);
  if (!consumed.matched) {
    return res.status(403).send("La validación de seguridad del inicio de sesión falló. Volvé a intentarlo.");
  }
  req.session.oauthStates = consumed.states;
  req.session.save((saveError) => {
    if (saveError) return next(saveError);
    passport.authenticate("google", { failureRedirect: `${config.APP_URL}/?auth=error`, session: true }, (error: Error | null, user: AuthUser | false) => {
      if (error) {
        console.error(JSON.stringify({ level: "ERROR", event: "oauth_callback", errorType: error.name }));
        return res.redirect(`${config.APP_URL}/?auth=error`);
      }
      if (!user) return res.redirect(`${config.APP_URL}/?auth=error`);
      const pendingGuest = user.status === "PENDING" && user.role === "INVITADO_ESPECIAL";
      if (user.status !== "ACTIVE" && !pendingGuest) return res.redirect(`${config.APP_URL}/?auth=pending`);
      const finish = !privilegedRoles.includes(user.role)
        ? completeAuthentication(req, user)
        : beginTwoFactorChallenge(req, user.id);
      void finish.then(() => res.redirect(config.APP_URL)).catch((loginError: Error) => {
        console.error(JSON.stringify({ level: "ERROR", event: "oauth_session", errorType: loginError.name }));
        res.redirect(`${config.APP_URL}/?auth=error`);
      });
    })(req, res, next);
  });
});

function isAllowedOrigin(origin: string): boolean {
  if (origin === config.APP_URL) return true;
  if (config.NODE_ENV === "production") return false;
  try {
    const requestedOrigin = new URL(origin);
    const configuredOrigin = new URL(config.APP_URL);
    return requestedOrigin.protocol === "http:"
      && requestedOrigin.hostname === getLanIpv4Address()
      && requestedOrigin.port === configuredOrigin.port;
  } catch {
    return false;
  }
}

const sameOrigin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const origin = req.get("origin");
  if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ error: "Origen no permitido." });
  next();
};
app.get("/auth/2fa/status", async (req, res, next) => {
  const userId = mfaUserId(req);
  if (!userId) return res.json({ step: null });
  try {
    const user = await getMfaUser(userId);
    if (!user || user.status !== "ACTIVE" || !privilegedRoles.includes(user.role as Role)) {
      return res.status(401).json({ error: "Iniciá sesión nuevamente." });
    }
    if (user.totpEnabledAt) return res.json({ step: "verify" });
    if (!req.session.totpSetupSecret || (req.session.totpSetupExpiresAt ?? 0) <= Date.now()) {
      req.session.totpSetupSecret = createTotpSecret();
      req.session.totpSetupExpiresAt = Date.now() + twoFactorPendingLifetimeMs;
      await saveSession(req);
    }
    return res.json({
      step: "enroll",
      setupSecret: req.session.totpSetupSecret,
      otpauthUrl: createTotpUri(req.session.totpSetupSecret, String(user.email)),
      accountLabel: String(user.email)
    });
  } catch (error) {
    next(error);
  }
});
app.post("/auth/2fa/enroll", sameOrigin, accountLimiter, async (req, res, next) => {
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ingresá el código de seis dígitos de tu app autenticadora." });
  const userId = mfaUserId(req);
  if (!userId) return res.status(401).json({ error: "La sesión de configuración venció. Iniciá sesión nuevamente." });
  if (!req.session.totpSetupSecret || (req.session.totpSetupExpiresAt ?? 0) <= Date.now()) {
    return res.status(400).json({ error: "La configuración venció. Actualizá la página para generar un nuevo código QR." });
  }
  const acceptedStep = verifyTotp(req.session.totpSetupSecret, parsed.data.code);
  if (acceptedStep === null) return res.status(400).json({ error: "El código no es válido o venció. Revisá la hora del dispositivo e intentá nuevamente." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<import("mysql2").RowDataPacket[]>(
      "SELECT role, status, totp_enabled_at AS totpEnabledAt FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    const row = rows[0];
    if (!row || row.status !== "ACTIVE" || !privilegedRoles.includes(row.role as Role)) {
      await connection.rollback();
      return res.status(401).json({ error: "Iniciá sesión nuevamente." });
    }
    if (row.totpEnabledAt) {
      await connection.rollback();
      return res.status(409).json({ error: "La verificación en dos pasos ya está configurada." });
    }
    const recoveryCodes = createRecoveryCodes();
    await connection.execute(
      `UPDATE users
       SET totp_secret = ?, totp_enabled_at = CURRENT_TIMESTAMP, totp_last_used_step = ?,
           totp_recovery_codes = ?
       WHERE id = ?`,
      [
        encryptTotpSecret(req.session.totpSetupSecret, config.TOTP_ENCRYPTION_SECRET),
        acceptedStep,
        JSON.stringify(recoveryCodes.map((code) => hashRecoveryCode(code, config.TOTP_ENCRYPTION_SECRET))),
        userId
      ]
    );
    await writeAudit(connection, {
      actorId: userId, action: "MFA_ENROLLED", resourceType: "USER", resourceId: userId
    });
    await connection.commit();
    const [userRows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
              is_demo AS isDemo, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
       FROM users WHERE id = ?`,
      [userId]
    );
    await completeAuthentication(req, toAuthUser(userRows[0]!));
    return res.json({ success: true, recoveryCodes });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});
app.post("/auth/2fa/verify", sameOrigin, accountLimiter, async (req, res, next) => {
  const parsed = z.object({ code: z.string().trim().min(6).max(32) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ingresá un código válido de tu app o de recuperación." });
  const userId = req.session.pendingTwoFactorUserId ?? mfaUserId(req);
  if (!userId) return res.status(401).json({ error: "La sesión de verificación venció. Iniciá sesión nuevamente." });
  const connection = await pool.getConnection();
  let authenticated = false;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<import("mysql2").RowDataPacket[]>(
      `SELECT role, status, totp_secret AS totpSecret, totp_enabled_at AS totpEnabledAt,
              totp_last_used_step AS totpLastUsedStep, totp_recovery_codes AS totpRecoveryCodes
       FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );
    const user = rows[0];
    if (!user || user.status !== "ACTIVE" || !privilegedRoles.includes(user.role as Role)) {
      await connection.rollback();
      return res.status(401).json({ error: "Iniciá sesión nuevamente." });
    }
    if (!user.totpEnabledAt || !user.totpSecret) {
      await connection.rollback();
      return res.status(409).json({ error: "La cuenta debe completar la configuración en dos pasos." });
    }
    const secret = decryptTotpSecret(String(user.totpSecret), config.TOTP_ENCRYPTION_SECRET);
    const usedStep = verifyTotp(secret, parsed.data.code);
    let recoveryCodes: string[] = [];
    if (Array.isArray(user.totpRecoveryCodes)) recoveryCodes = user.totpRecoveryCodes.map(String);
    else if (typeof user.totpRecoveryCodes === "string") recoveryCodes = JSON.parse(user.totpRecoveryCodes) as string[];
    const recoveryIndex = usedStep === null
      ? recoveryCodes.findIndex((hash) => matchesRecoveryCode(parsed.data.code, hash, config.TOTP_ENCRYPTION_SECRET))
      : -1;
    if (usedStep === null && recoveryIndex < 0) {
      await writeAudit(connection, {
        actorId: userId, action: "MFA_LOGIN_FAILED", resourceType: "USER", resourceId: userId, outcome: "DENIED"
      });
      await connection.commit();
      return res.status(401).json({ error: "El código no es válido o ya fue utilizado." });
    }
    if (usedStep !== null && usedStep <= Number(user.totpLastUsedStep ?? -1)) {
      await writeAudit(connection, {
        actorId: userId, action: "MFA_LOGIN_FAILED", resourceType: "USER", resourceId: userId, outcome: "DENIED"
      });
      await connection.commit();
      return res.status(401).json({ error: "El código ya fue utilizado. Esperá el siguiente código e intentá nuevamente." });
    }
    if (usedStep !== null) {
      await connection.execute(
        "UPDATE users SET totp_last_used_step = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
        [usedStep, userId]
      );
    } else {
      recoveryCodes.splice(recoveryIndex, 1);
      await connection.execute(
        "UPDATE users SET totp_recovery_codes = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
        [JSON.stringify(recoveryCodes), userId]
      );
    }
    await writeAudit(connection, {
      actorId: userId,
      action: usedStep === null ? "MFA_RECOVERY_USED" : "MFA_LOGIN_VERIFIED",
      resourceType: "USER",
      resourceId: userId
    });
    await connection.commit();
    authenticated = true;
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
  if (!authenticated) return res.status(401).json({ error: "No se pudo verificar el acceso." });
  try {
    const [userRows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
              is_demo AS isDemo, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
       FROM users WHERE id = ?`,
      [userId]
    );
    if (!userRows[0]) return res.status(401).json({ error: "Iniciá sesión nuevamente." });
    await completeAuthentication(req, toAuthUser(userRows[0]));
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});
app.post("/auth/register", sameOrigin, accountLimiter, async (req, res, next) => {
  const parsed = z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    dni: z.string().trim().regex(/^\d{7,10}$/, "El DNI debe tener entre 7 y 10 números."),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,80}$/, "El usuario debe tener 3 a 80 caracteres y solo usar letras, números, punto, guion o guion bajo.").optional().or(z.literal("")),
    email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
    phone: z.string().trim().max(30).optional(),
    role: z.enum(["ALUMNO", "DOCENTE", "NO_DOCENTE", "INVITADO_ESPECIAL"]),
    password: z.string().min(10).max(128)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Revisá los datos ingresados." });
  try {
    const id = randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO users (id, dni, username, email, first_name, last_name, phone, password_hash, role, status, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
        [id, parsed.data.dni, parsed.data.username || null, parsed.data.email, parsed.data.firstName, parsed.data.lastName, parsed.data.phone || null, passwordHash, parsed.data.role]
      );
      await writeAudit(connection, {
        actorId: null, action: "user.registration_pending", resourceType: "user", resourceId: id,
        metadata: { role: parsed.data.role, method: "LOCAL" }
      });
      await connection.commit();
      return res.status(201).json({ approvalRequired: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya existe una cuenta con ese DNI, usuario o correo." });
    }
    next(error);
  }
});
app.post("/auth/login", sameOrigin, accountLimiter, async (req, res, next) => {
  const parsed = z.object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ingresá tu DNI o usuario y contraseña." });
  try {
    const identifier = parsed.data.identifier.trim();
    if (!isDemoMode && ["comedor", "supervisor"].includes(identifier.toLowerCase())) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
              is_demo AS isDemo, password_hash AS passwordHash, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
       FROM users
       WHERE status = 'ACTIVE' AND ((dni = ? AND role IN ('ALUMNO','DOCENTE','NO_DOCENTE','INVITADO_ESPECIAL')) OR username = ?)
       LIMIT 1`,
      [identifier, identifier]
    );
    const account = rows[0];
    if (account?.isDemo && !isDemoMode) {
      const connection = await pool.getConnection();
      try {
        await writeAudit(connection, {
          actorId: null,
          action: "login.failed",
          resourceType: "authentication",
          outcome: "DENIED",
          metadata: { knownAccount: false }
        });
      } finally {
        connection.release();
      }
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }
    if (!account?.passwordHash || !await verifyPassword(parsed.data.password, String(account.passwordHash))) {
      const connection = await pool.getConnection();
      try {
        await writeAudit(connection, {
          actorId: null,
          action: "login.failed",
          resourceType: "authentication",
          outcome: "DENIED",
          metadata: { knownAccount: Boolean(account?.passwordHash) }
        });
      } finally {
        connection.release();
      }
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }
    const user = toAuthUser(account);
    if (privilegedRoles.includes(user.role)) {
      await beginTwoFactorChallenge(req, user.id);
      return res.json({ twoFactorRequired: true });
    }
    await completeAuthentication(req, user);
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
app.post("/auth/demo", sameOrigin, authLimiter, async (req, res, next) => {
  if (!isDemoMode) return res.status(404).json({ error: "Ruta no disponible." });
  const parsed = z.object({ role: z.enum(roles) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Rol demo no válido." });
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
              is_demo AS isDemo, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
       FROM users WHERE role = ? AND is_demo = 1 AND status = 'ACTIVE' LIMIT 1`,
      [parsed.data.role]
    );
    if (!rows[0]) return res.status(404).json({ error: "No hay un usuario demo de ese rol. Ejecutá npm run db:seed con DEMO_MODE=true." });
    const user = toAuthUser(rows[0]);
    if (privilegedRoles.includes(user.role)) {
      await beginTwoFactorChallenge(req, user.id);
      return res.json({ twoFactorRequired: true });
    }
    await completeAuthentication(req, user);
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
app.post("/auth/demo/guest", sameOrigin, authLimiter, async (req, res, next) => {
  if (!isGuestDemoMode) return res.status(404).json({ error: "Ruta no disponible." });
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, email, dni, phone, first_name AS firstName, last_name AS lastName, role, status,
              is_demo AS isDemo, (totp_enabled_at IS NOT NULL) AS twoFactorEnabled
       FROM users WHERE role = 'INVITADO_ESPECIAL' AND is_demo = 1 AND status = 'ACTIVE' LIMIT 1`
    );
    if (!rows[0]) return res.status(404).json({ error: "No hay cuenta demo de invitado. Ejecutá npm run db:seed con DEMO_GUEST_MODE=true." });
    await completeAuthentication(req, toAuthUser(rows[0]));
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/logout", sameOrigin, (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie("unca.sid", { httpOnly: true, sameSite: "lax", secure: config.NODE_ENV === "production" });
      res.status(204).end();
    });
  });
});

app.get("/api/profile/photo", async (req, res, next) => {
  const user = req.user as AuthUser | undefined;
  if (!user || user.status !== "ACTIVE" || (privilegedRoles.includes(user.role) && (!user.twoFactorEnabled || !req.session.twoFactorVerified))) {
    return res.status(404).end();
  }
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      "SELECT mime_type AS mimeType, image_data AS imageData FROM profile_photos WHERE user_id = ? LIMIT 1",
      [user.id]
    );
    const photo = rows[0];
    if (!photo) return res.status(204).end();
    if (!Buffer.isBuffer(photo.imageData)) return res.status(404).end();
    res.setHeader("Content-Type", String(photo.mimeType));
    res.setHeader("Content-Length", photo.imageData.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(photo.imageData);
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/profile/photo",
  sameOrigin,
  profilePhotoUploadLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
  async (req, res, next) => {
    const user = req.user as AuthUser | undefined;
    if (!user || user.status !== "ACTIVE") return res.status(401).json({ error: "Iniciá sesión para continuar." });
    if (privilegedRoles.includes(user.role) && (!user.twoFactorEnabled || !req.session.twoFactorVerified)) {
      return res.status(403).json({ error: "Configurá la verificación en dos pasos para continuar." });
    }

    const mimeType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const image = req.body;
    if (!Buffer.isBuffer(image) || image.length === 0) {
      return res.status(400).json({ error: "Seleccioná una imagen PNG, JPEG o WebP de hasta 5 MB." });
    }
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
      return res.status(415).json({ error: "El formato debe ser PNG, JPEG o WebP." });
    }
    const isPng = mimeType === "image/png" && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mimeType === "image/jpeg" && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = mimeType === "image/webp" && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) {
      return res.status(415).json({ error: "El contenido no coincide con una imagen PNG, JPEG o WebP válida." });
    }

    let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
    let transactionStarted = false;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      await connection.execute(
        `INSERT INTO profile_photos (user_id, mime_type, image_data) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), image_data = VALUES(image_data)`,
        [user.id, mimeType, image]
      );
      await writeAudit(connection, {
        actorId: user.id, action: "profile.photo_updated", resourceType: "user", resourceId: user.id,
        metadata: { mimeType, bytes: image.length }
      });
      await connection.commit();
      transactionStarted = false;
      return res.status(201).json({ success: true });
    } catch (error) {
      if (transactionStarted && connection && !(await rollbackSafely(connection, "profile.photo_update"))) connection = undefined;
      return next(error);
    } finally {
      connection?.release();
    }
  }
);

app.post(
  "/api/payments/proof",
  sameOrigin,
  profilePhotoUploadLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
  async (req, res, next) => {
    const user = req.user as AuthUser | undefined;
    if (!user || user.status !== "ACTIVE") return res.status(401).json({ error: "Iniciá sesión para continuar." });
    if (privilegedRoles.includes(user.role) && (!user.twoFactorEnabled || !req.session.twoFactorVerified)) {
      return res.status(403).json({ error: "Configurá la verificación en dos pasos para continuar." });
    }
    const rawReservationIds = req.query.reservationIds;
    const reservationIds = typeof rawReservationIds === "string" ? rawReservationIds.split(",") : [];
    const reservationIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if (reservationIds.length === 0 || reservationIds.length > 100 ||
        new Set(reservationIds).size !== reservationIds.length || reservationIds.some((id) => !reservationIdPattern.test(id))) {
      return res.status(400).json({ error: "Seleccioná reservas válidas para informar el pago." });
    }

    const mimeType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const image = req.body;
    const method = String(req.query.method ?? "");
    if (!paymentMethodValues.includes(method as (typeof paymentMethodValues)[number])) {
      return res.status(400).json({ error: "Elegí un medio de pago válido." });
    }
    const providerReference = typeof req.query.reference === "string" ? req.query.reference.trim() : "";
    if (providerReference.length < 3 || providerReference.length > 191 || !/^[\p{L}\p{N}._/-]+$/u.test(providerReference)) {
      return res.status(400).json({ error: "Ingresá una referencia válida de la operación." });
    }
    const declaredCents = typeof req.query.amount === "string" ? parseMoneyToCents(req.query.amount.trim()) : null;
    if (declaredCents === null) return res.status(400).json({ error: "Ingresá el importe declarado con hasta dos decimales." });
    const declaredAmount = moneyCentsToDecimal(declaredCents);
    if (!Buffer.isBuffer(image) || image.length === 0) {
      return res.status(400).json({ error: "Seleccioná una imagen PNG, JPEG o WebP de hasta 5 MB." });
    }
    const isPng = mimeType === "image/png" && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mimeType === "image/jpeg" && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = mimeType === "image/webp" && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) {
      return res.status(415).json({ error: "El contenido no coincide con una imagen PNG, JPEG o WebP válida." });
    }

    let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
    let transactionStarted = false;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const placeholders = reservationIds.map(() => "?").join(", ");
      const [reservationRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        `SELECT id, price_amount AS amount, price_currency AS currency, payment_status AS paymentStatus, status
         FROM reservations WHERE id IN (${placeholders}) AND user_id = ? ORDER BY id FOR UPDATE`,
        [...reservationIds, user.id]
      );
      if (reservationRows.length !== reservationIds.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ error: "No encontramos una o más reservas seleccionadas." });
      }
      if (reservationRows.some((reservation) => reservation.status !== "PENDIENTE" || Number(reservation.amount) <= 0 ||
          !["PENDIENTE", "RECHAZADO"].includes(String(reservation.paymentStatus)))) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({ error: "Una o más reservas no admiten pagos en su estado actual." });
      }
      const currencies = new Set(reservationRows.map((reservation) => String(reservation.currency)));
      if (currencies.size !== 1) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({ error: "Las reservas tienen monedas distintas y no se pueden agrupar." });
      }
      const totalCents = sumMoneyToCents(reservationRows.map((reservation) => String(reservation.amount)));
      if (totalCents === null) throw new Error("No se pudo calcular el importe histórico de las reservas.");
      const totalAmount = moneyCentsToDecimal(totalCents);
      const currency = String(reservationRows[0].currency);
      const [directPaymentRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        `SELECT id, status, reservation_id AS reservationId FROM payment_references
         WHERE reservation_id IN (${placeholders}) FOR UPDATE`,
        reservationIds
      );
      const [linkedPaymentRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        `SELECT p.id, p.status, p.reservation_id AS reservationId
         FROM payment_reference_reservations pr JOIN payment_references p ON p.id = pr.payment_reference_id
         WHERE pr.reservation_id IN (${placeholders}) FOR UPDATE`,
        reservationIds
      );
      const existingPayments = new Map([...directPaymentRows, ...linkedPaymentRows].map((payment) => [String(payment.id), payment]));
      if ([...existingPayments.values()].some((payment) => payment.status !== "RECHAZADO")) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({ error: "Ya se informó un pago para una o más reservas seleccionadas." });
      }

      const anchorReservationId = reservationIds[0];
      const existingAnchor = directPaymentRows.find((payment) => String(payment.reservationId) === anchorReservationId);
      const paymentId = existingAnchor ? String(existingAnchor.id) : randomUUID();
      const [duplicateReferences] = await connection.execute<import("mysql2").RowDataPacket[]>(
        `SELECT id FROM payment_references
         WHERE provider = 'REFERENCIA_MANUAL' AND method = ? AND provider_reference = ? AND id <> ? FOR UPDATE`,
        [method, providerReference, paymentId]
      );
      if (duplicateReferences.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({ error: "Ya existe una operación con esa referencia para el mismo medio de pago. Verificá el identificador exacto de esta transferencia." });
      }
      if (existingAnchor) {
        await connection.execute(
          `UPDATE payment_references SET provider_reference = ?, method = ?, proof_mime_type = ?, proof_image = ?,
           amount = ?, currency = ?, status = 'PENDIENTE', reviewed_by = NULL, reviewed_at = NULL,
           created_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [providerReference, method, mimeType, image, declaredAmount, currency, paymentId]
        );
        await connection.execute("DELETE FROM payment_reference_reservations WHERE payment_reference_id = ?", [paymentId]);
      } else {
        await connection.execute(
          `INSERT INTO payment_references
           (id, user_id, reservation_id, provider, provider_reference, method, proof_mime_type, proof_image, amount, currency, status)
           VALUES (?, ?, ?, 'REFERENCIA_MANUAL', ?, ?, ?, ?, ?, ?, 'PENDIENTE')`,
          [paymentId, user.id, anchorReservationId, providerReference, method, mimeType, image, declaredAmount, currency]
        );
      }
      const associationPlaceholders = reservationIds.map(() => "(?, ?)").join(", ");
      await connection.execute(
        `INSERT INTO payment_reference_reservations (payment_reference_id, reservation_id) VALUES ${associationPlaceholders}`,
        reservationIds.flatMap((reservationId) => [paymentId, reservationId])
      );
      await connection.execute(
        `UPDATE reservations SET payment_status = 'PENDIENTE' WHERE id IN (${placeholders})`,
        reservationIds
      );
      await connection.execute(
        `INSERT INTO payment_evidence
         (id, payment_reference_id, submitted_by, provider_reference, method, declared_amount, currency, mime_type, image_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), paymentId, user.id, providerReference, method, declaredAmount, currency, mimeType, image]
      );
      await connection.execute(
        `INSERT INTO payment_finance_events
         (id, payment_reference_id, event_type, amount, currency, reference, actor_id)
         VALUES (?, ?, 'COMPROBANTE_PRESENTADO', ?, ?, ?, ?)`,
        [randomUUID(), paymentId, declaredAmount, currency, providerReference, user.id]
      );
      await writeAudit(connection, {
        actorId: user.id, action: "payment.proof_submit", resourceType: "payment_reference", resourceId: paymentId,
        metadata: { method, mimeType, bytes: image.length, reservationCount: reservationIds.length, totalAmount, declaredAmount, currency }
      });
      await connection.commit();
      transactionStarted = false;
      return res.status(201).json({ id: paymentId });
    } catch (error) {
      if (transactionStarted && connection && !(await rollbackSafely(connection, "payment.proof_submit"))) connection = undefined;
      return next(error);
    } finally {
      connection?.release();
    }
  }
);

app.get("/api/payments/:id/proof", async (req, res, next) => {
  const user = req.user as AuthUser | undefined;
  if (!user || user.status !== "ACTIVE" || (privilegedRoles.includes(user.role) && (!user.twoFactorEnabled || !req.session.twoFactorVerified))) {
    return res.status(404).end();
  }
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).end();
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT user_id AS userId, proof_mime_type AS mimeType, proof_image AS imageData
       FROM payment_references WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    const proof = rows[0];
    if (!proof || (String(proof.userId) !== user.id && !hasPermission(user.role, "payments:read")) ||
        !Buffer.isBuffer(proof.imageData) || !["image/jpeg", "image/png", "image/webp"].includes(String(proof.mimeType))) {
      return res.status(404).end();
    }
    res.setHeader("Content-Type", String(proof.mimeType));
    res.setHeader("Content-Length", proof.imageData.length);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(proof.imageData);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/payments/:id/evidence/:evidenceId", async (req, res, next) => {
  const user = req.user as AuthUser | undefined;
  if (!user || user.status !== "ACTIVE" || (privilegedRoles.includes(user.role) && (!user.twoFactorEnabled || !req.session.twoFactorVerified))) {
    return res.status(404).end();
  }
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !/^[0-9a-f-]{36}$/i.test(req.params.evidenceId)) return res.status(404).end();
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT p.user_id AS userId, e.mime_type AS mimeType, e.image_data AS imageData
       FROM payment_evidence e JOIN payment_references p ON p.id = e.payment_reference_id
       WHERE p.id = ? AND e.id = ? LIMIT 1`,
      [req.params.id, req.params.evidenceId]
    );
    const evidence = rows[0];
    if (!evidence || (String(evidence.userId) !== user.id && !hasPermission(user.role, "payments:read")) ||
        !Buffer.isBuffer(evidence.imageData) || !["image/jpeg", "image/png", "image/webp"].includes(String(evidence.mimeType))) {
      return res.status(404).end();
    }
    res.setHeader("Content-Type", String(evidence.mimeType));
    res.setHeader("Content-Length", evidence.imageData.length);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(evidence.imageData);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/cash/receipts/:receiptNumber", cashReceiptVerificationLimiter, async (req, res, next) => {
  const receiptNumber = Array.isArray(req.params.receiptNumber) ? req.params.receiptNumber[0] : req.params.receiptNumber;
  if (typeof receiptNumber !== "string" || !/^[1-9]\d{0,8}$/.test(receiptNumber)) return res.status(404).end();
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT receipt_number AS receiptNumber, amount, currency, status, received_at AS receivedAt
       FROM cash_receipts WHERE receipt_number = ? LIMIT 1`,
      [Number(receiptNumber)]
    );
    const receipt = rows[0];
    if (!receipt) return res.status(404).json({ valid: false });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.json({
      valid: receipt.status === "CONFIRMADO",
      receiptNumber: Number(receipt.receiptNumber),
      status: String(receipt.status),
      amount: String(receipt.amount),
      currency: String(receipt.currency),
      receivedAt: receipt.receivedAt
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/profile/photo", sameOrigin, async (req, res, next) => {
  const user = req.user as AuthUser | undefined;
  if (!user || user.status !== "ACTIVE") return res.status(401).json({ error: "Iniciá sesión para continuar." });
  if (privilegedRoles.includes(user.role) && (!user.twoFactorEnabled || !req.session.twoFactorVerified)) {
    return res.status(403).json({ error: "Configurá la verificación en dos pasos para continuar." });
  }
  let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute("DELETE FROM profile_photos WHERE user_id = ?", [user.id]);
    await writeAudit(connection, { actorId: user.id, action: "profile.photo_removed", resourceType: "user", resourceId: user.id });
    await connection.commit();
    transactionStarted = false;
    return res.status(204).end();
  } catch (error) {
    if (transactionStarted && connection) await connection.rollback();
    return next(error);
  } finally {
    connection?.release();
  }
});

app.get("/api/carousel/photos/:id", async (req, res, next) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).end();
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      "SELECT mime_type AS mimeType, image_data AS imageData FROM carousel_photos WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    const photo = rows[0];
    if (!photo || !Buffer.isBuffer(photo.imageData)) return res.status(404).end();
    res.setHeader("Content-Type", String(photo.mimeType));
    res.setHeader("Content-Length", photo.imageData.length);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(photo.imageData);
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/carousel/photos",
  sameOrigin,
  carouselUploadLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
  async (req, res, next) => {
    const user = req.user as AuthUser | undefined;
    if (!user || user.status !== "ACTIVE") return res.status(401).json({ error: "Iniciá sesión para continuar." });
    if (user.role !== "ADMINISTRADOR_LOCAL" || user.isDemo || !user.twoFactorEnabled || !req.session.twoFactorVerified) {
      return res.status(403).json({ error: "Solo el Administrador Local con verificación en dos pasos puede subir fotos." });
    }

    const mimeType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const image = req.body;
    if (!Buffer.isBuffer(image) || image.length === 0) {
      return res.status(400).json({ error: "Seleccioná una imagen PNG, JPEG o WebP de hasta 5 MB." });
    }
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
      return res.status(415).json({ error: "El formato debe ser PNG, JPEG o WebP." });
    }
    if (image.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: "Cada imagen puede pesar hasta 5 MB." });
    }
    const isPng = mimeType === "image/png" && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mimeType === "image/jpeg" && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = mimeType === "image/webp" && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) {
      return res.status(415).json({ error: "El contenido del archivo no coincide con una imagen PNG, JPEG o WebP válida." });
    }

    const rawCaption = typeof req.query.caption === "string" ? req.query.caption : "";
    const caption = rawCaption.replace(/\.[^.]+$/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) || "Foto del comedor";
    let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
    let transactionStarted = false;
    let uploadLockAcquired = false;
    try {
      connection = await pool.getConnection();
      const [lockRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        "SELECT GET_LOCK('comedor_carousel_upload', 5) AS acquired"
      );
      if (Number(lockRows[0]?.acquired) !== 1) {
        return res.status(503).json({ error: "No se pudo reservar el espacio de carga. Intentá nuevamente." });
      }
      uploadLockAcquired = true;

      const [countRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM carousel_photos"
      );
      if (Number(countRows[0]?.total ?? 0) >= 17) {
        return res.status(409).json({ error: "El carrusel ya tiene 20 fotos. Quitá una antes de agregar otra." });
      }

      const id = randomUUID();
      await connection.beginTransaction();
      transactionStarted = true;
      await connection.execute(
        `INSERT INTO carousel_photos (id, caption, mime_type, image_data, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, caption, mimeType, image, user.id]
      );
      await writeAudit(connection, {
        actorId: user.id,
        action: "carousel.photo_added",
        resourceType: "carousel_photo",
        resourceId: id,
        metadata: { caption, bytes: image.length }
      });
      await connection.commit();
      transactionStarted = false;
      return res.status(201).json({ id, caption });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(JSON.stringify({ level: "ERROR", event: "carousel_upload_rollback_failed", errorType: rollbackError instanceof Error ? rollbackError.name : "UnknownError" }));
          connection.destroy();
          connection = undefined;
        }
      }
      return next(error);
    } finally {
      if (connection && uploadLockAcquired) {
        try {
          await connection.execute("SELECT RELEASE_LOCK('comedor_carousel_upload')");
        } catch (releaseError) {
          console.error(JSON.stringify({ level: "ERROR", event: "carousel_upload_lock_release_failed", errorType: releaseError instanceof Error ? releaseError.name : "UnknownError" }));
          connection.destroy();
          connection = undefined;
        }
      }
      connection?.release();
    }
  }
);

app.get("/api/events-news/photos/:id", async (req, res, next) => {
  const photoId = req.params.id;
  if (typeof photoId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(photoId)) return res.status(404).end();
  try {
    const [rows] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT p.mime_type AS mimeType, p.image_data AS imageData, n.published, n.visibility
       FROM events_news_photos p
       INNER JOIN events_news n ON n.id = p.entry_id
       WHERE p.id = ? LIMIT 1`,
      [photoId]
    );
    const photo = rows[0];
    if (!photo || !Buffer.isBuffer(photo.imageData)) return res.status(404).end();
    const user = req.user as AuthUser | undefined;
    if (!user || user.status !== "ACTIVE") return res.status(404).end();
    const published = Number(photo.published) === 1;
    const visibility = String(photo.visibility) === "PRIVADO" ? "PRIVADO" : "PUBLICO";
    const canViewPhoto = canViewEventsNewsEntry({
      role: user.role,
      isDemo: user.isDemo,
      twoFactorVerified: user.twoFactorEnabled && req.session.twoFactorVerified === true,
      published,
      visibility
    });
    if (!canViewPhoto) return res.status(404).end();
    res.setHeader("Content-Type", String(photo.mimeType));
    res.setHeader("Content-Length", photo.imageData.length);
    res.setHeader("Cache-Control", published && visibility === "PUBLICO" ? "private, max-age=300" : "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(photo.imageData);
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/events-news/:entryId/photos",
  sameOrigin,
  carouselUploadLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
  async (req, res, next) => {
    const user = req.user as AuthUser | undefined;
    if (!user || user.status !== "ACTIVE") return res.status(401).json({ error: "Iniciá sesión para continuar." });
    if (user.role !== "ADMINISTRADOR_LOCAL" || user.isDemo || !user.twoFactorEnabled || !req.session.twoFactorVerified) {
      return res.status(403).json({ error: "Solo el Administrador Local con verificación en dos pasos puede subir fotos." });
    }
    const entryId = req.params.entryId;
    if (typeof entryId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entryId)) return res.status(404).json({ error: "La publicación no está disponible." });

    const mimeType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const image = req.body;
    if (!Buffer.isBuffer(image) || image.length === 0) {
      return res.status(400).json({ error: "Seleccioná una imagen PNG, JPEG o WebP de hasta 5 MB." });
    }
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
      return res.status(415).json({ error: "El formato debe ser PNG, JPEG o WebP." });
    }
    const isPng = mimeType === "image/png" && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mimeType === "image/jpeg" && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = mimeType === "image/webp" && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) {
      return res.status(415).json({ error: "El contenido del archivo no coincide con una imagen PNG, JPEG o WebP válida." });
    }

    let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
    let transactionStarted = false;
    let uploadLockAcquired = false;
    try {
      connection = await pool.getConnection();
      const [lockRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        "SELECT GET_LOCK(?, 5) AS acquired",
        [`events_news_photo_${entryId}`]
      );
      if (Number(lockRows[0]?.acquired) !== 1) {
        return res.status(503).json({ error: "No se pudo reservar el espacio de carga. Intentá nuevamente." });
      }
      uploadLockAcquired = true;
      const [entryRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        "SELECT id FROM events_news WHERE id = ? LIMIT 1",
        [entryId]
      );
      if (!entryRows.length) return res.status(404).json({ error: "La publicación ya no está disponible." });
      const [countRows] = await connection.execute<import("mysql2").RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM events_news_photos WHERE entry_id = ?",
        [entryId]
      );
      if (Number(countRows[0]?.total ?? 0) >= 10) {
        return res.status(409).json({ error: "Cada publicación admite hasta 10 fotos." });
      }

      const id = randomUUID();
      await connection.beginTransaction();
      transactionStarted = true;
      await connection.execute(
        `INSERT INTO events_news_photos (id, entry_id, mime_type, image_data, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, entryId, mimeType, image, user.id]
      );
      await writeAudit(connection, {
        actorId: user.id,
        action: "events_news.photo_added",
        resourceType: "events_news_photo",
        resourceId: id,
        metadata: { entryId, bytes: image.length }
      });
      await connection.commit();
      transactionStarted = false;
      return res.status(201).json({ id });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(JSON.stringify({ level: "ERROR", event: "events_news_photo_rollback_failed", errorType: rollbackError instanceof Error ? rollbackError.name : "UnknownError" }));
          connection.destroy();
          connection = undefined;
        }
      }
      return next(error);
    } finally {
      if (connection && uploadLockAcquired) {
        try {
          await connection.execute("SELECT RELEASE_LOCK(?)", [`events_news_photo_${entryId}`]);
        } catch (releaseError) {
          console.error(JSON.stringify({ level: "ERROR", event: "events_news_photo_lock_release_failed", errorType: releaseError instanceof Error ? releaseError.name : "UnknownError" }));
          connection.destroy();
          connection = undefined;
        }
      }
      connection?.release();
    }
  }
);

app.use("/trpc/reservations.create", bookingLimiter);
app.use("/trpc/reservations.createMany", bookingLimiter);
app.use("/trpc/reservations.cancel", bookingLimiter);
app.use("/trpc/reservations.validateTicket", ticketValidationLimiter);
app.use("/trpc", (req, res, next) => {
  const origin = req.get("origin");
  if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ error: "Origen no permitido." });
  next();
}, createExpressMiddleware({ router: appRouter, createContext }));

async function getHealthStatus() {
  try {
    await pool.query("SELECT 1");
    return { status: "ok", database: "connected" };
  } catch {
    return { status: "degraded", database: "unavailable" };
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function getLanIpv4Address(): string | undefined {
  const addresses = Object.values(networkInterfaces()).flatMap((details) => details ?? [])
    .filter((details) => details.family === "IPv4" && !details.internal && !details.address.startsWith("169.254."));
  const priority = (address: string) => {
    if (address.startsWith("192.168.")) return 3;
    if (address.startsWith("10.")) return 2;
    const secondOctet = Number(address.split(".")[1]);
    if (address.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31) return 1;
    return 0;
  };
  return addresses.sort((left, right) => priority(right.address) - priority(left.address))[0]?.address;
}

app.get("/api/access-url", (req, res) => {
  const configuredUrl = new URL(config.APP_URL);
  if (config.NODE_ENV === "production" || !isLoopbackHost(configuredUrl.hostname)) {
    return res.json({ url: config.APP_URL });
  }

  const lanAddress = getLanIpv4Address();
  if (!lanAddress) return res.status(503).json({ error: "No encontramos una dirección de red local para el QR." });

  const requestedPort = z.coerce.number().int().min(1).max(65535).safeParse(req.query.port);
  const port = requestedPort.success ? requestedPort.data : 5173;
  return res.json({ url: `http://${lanAddress}:${port}` });
});

app.get("/api/weather", weatherLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = z.object({ city: z.string().trim().min(2).max(80) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Indicá una localidad válida." });

  const city = parsed.data.city;
  const cacheKey = city.toLocaleLowerCase("es-AR");
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({
      ...cached.snapshot,
      cacheHit: true,
      cacheAgeSeconds: Math.floor((Date.now() - Date.parse(cached.snapshot.fetchedAt)) / 1000)
    });
  }
  if (cached) weatherCache.delete(cacheKey);

  try {
    const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodingUrl.searchParams.set("name", city);
    geocodingUrl.searchParams.set("count", "1");
    geocodingUrl.searchParams.set("language", "es");
    geocodingUrl.searchParams.set("format", "json");
    geocodingUrl.searchParams.set("countryCode", "AR");
    const geocodingResponse = await fetch(geocodingUrl, { signal: AbortSignal.timeout(8_000) });
    if (!geocodingResponse.ok) throw new Error("weather_geocoding_unavailable");
    const geocoding = await geocodingResponse.json() as {
      results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }>;
    };
    const location = geocoding.results?.[0];
    if (!location) return res.status(404).json({ error: "No se encontró esa localidad en Argentina." });

    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.searchParams.set("latitude", String(location.latitude));
    forecastUrl.searchParams.set("longitude", String(location.longitude));
    forecastUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m");
    forecastUrl.searchParams.set("hourly", "precipitation_probability");
    forecastUrl.searchParams.set("timezone", "America/Argentina/Catamarca");
    forecastUrl.searchParams.set("forecast_days", "1");
    const forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(8_000) });
    if (!forecastResponse.ok) throw new Error("weather_forecast_unavailable");
    const forecast = await forecastResponse.json() as {
      current?: {
        time?: string; temperature_2m?: number; apparent_temperature?: number;
        relative_humidity_2m?: number; weather_code?: number; wind_speed_10m?: number;
      };
      hourly?: { time?: string[]; precipitation_probability?: Array<number | null> };
    };
    const current = forecast.current;
    if (!current || !current.time || ![
      current.temperature_2m, current.apparent_temperature, current.relative_humidity_2m,
      current.weather_code, current.wind_speed_10m
    ].every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("weather_current_values_missing");
    }
    const currentHour = current.time.slice(0, 13);
    const precipitationIndex = forecast.hourly?.time?.findIndex((time) => time.slice(0, 13) === currentHour) ?? -1;
    const probability = precipitationIndex >= 0
      ? forecast.hourly?.precipitation_probability?.[precipitationIndex]
      : null;
    const fetchedAt = new Date().toISOString();
    const snapshot: WeatherSnapshot = {
      location: {
        name: location.name, region: location.admin1 ?? null,
        country: location.country ?? "Argentina", latitude: location.latitude, longitude: location.longitude
      },
      current: {
        temperatureC: current.temperature_2m!, feelsLikeC: current.apparent_temperature!,
        humidityPercent: current.relative_humidity_2m!, windKmh: current.wind_speed_10m!,
        weatherCode: current.weather_code!,
        precipitationProbabilityPercent: typeof probability === "number" && Number.isFinite(probability) ? probability : null,
        observedAt: current.time
      },
      fetchedAt,
      source: "Open-Meteo"
    };
    weatherCache.set(cacheKey, { snapshot, expiresAt: Date.now() + weatherCacheLifetimeMs });
    while (weatherCache.size > 20) {
      const oldestKey = weatherCache.keys().next().value;
      if (!oldestKey) break;
      weatherCache.delete(oldestKey);
    }
    return res.json({ ...snapshot, cacheHit: false, cacheAgeSeconds: 0 });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    const errorCode = error instanceof Error ? error.message : "weather_unavailable";
    console.error(JSON.stringify({ level: "WARN", event: "weather_fetch_failed", errorCode }));
    return res.status(timeout ? 504 : 502).json({
      error: timeout ? "El servicio meteorológico tardó demasiado en responder." : "No se pudieron obtener datos meteorológicos actuales."
    });
  }
});

app.get("/health", async (_req, res) => {
  const status = await getHealthStatus();
  const httpStatus = status.status === "ok" ? 200 : 503;
  res.status(httpStatus).json(status);
});

app.get("/ready", async (_req, res) => {
  const status = await getHealthStatus();
  const httpStatus = status.status === "ok" ? 200 : 503;
  res.status(httpStatus).json({
    ...status,
    ready: status.status === "ok",
    environment: config.NODE_ENV,
    version: packageJson.version
  });
});

app.get("/version", (_req, res) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    environment: config.NODE_ENV,
    featureFlags
  });
});

app.get("/api/health", async (_req, res) => {
  const status = await getHealthStatus();
  const httpStatus = status.status === "ok" ? 200 : 503;
  res.status(httpStatus).json(status);
});

if (config.NODE_ENV === "production") {
  app.use(express.static("dist"));
  app.get("*", (_req, res) => res.sendFile("index.html", { root: "dist" }));
}

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  const requestId = String(res.locals.requestId ?? "");
  console.error(JSON.stringify({ level: "ERROR", errorType, code, requestId }));
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Ocurrió un error inesperado. Intentá nuevamente.", requestId });
});

const server = app.listen(config.PORT, () => {
  console.info(JSON.stringify({ level: "INFO", event: "server_started", port: config.PORT, environment: config.NODE_ENV }));
});

let expiryRunning = false;
async function runReservationExpiry() {
  if (expiryRunning) return;
  expiryRunning = true;
  try {
    await expireReservations();
  } catch (error) {
    console.error(JSON.stringify({
      level: "ERROR",
      event: "reservation_expiry_failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    }));
  } finally {
    expiryRunning = false;
  }
}
void runReservationExpiry();
const reservationExpiryTimer = setInterval(() => void runReservationExpiry(), 30_000);

let waitlistExpiryRunning = false;
async function runWaitlistExpiry() {
  if (waitlistExpiryRunning) return;
  waitlistExpiryRunning = true;
  try {
    await expireWaitlistOffers();
  } catch (error) {
    console.error(JSON.stringify({
      level: "ERROR",
      event: "waitlist_expiry_failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    }));
  } finally {
    waitlistExpiryRunning = false;
  }
}
void runWaitlistExpiry();
const waitlistExpiryTimer = setInterval(() => void runWaitlistExpiry(), 30_000);

async function shutdown() {
  clearInterval(reservationExpiryTimer);
  clearInterval(waitlistExpiryTimer);
  server.close();
  sessionStore.close();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
