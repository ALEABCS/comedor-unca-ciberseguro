import "dotenv/config";
import { z } from "zod";
import { resolveFeatureFlags } from "./security/feature-flags";
import { validateSigningSecrets } from "./security/secrets";

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
const databaseUrl = configuredDatabaseUrl ? new URL(configuredDatabaseUrl) : null;
if (databaseUrl && !["mysql:", "mysql2:"].includes(databaseUrl.protocol)) {
  throw new Error("DATABASE_URL debe usar el protocolo mysql:// o mysql2://.");
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().url().optional()
  ),
  DB_HOST: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_USER: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  DB_PASSWORD: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  DB_NAME: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CALLBACK_URL: z.string().url().default("http://localhost:4000/auth/google/callback"),
  SESSION_SECRET: z.string().default(""),
  QR_SIGNING_SECRET: z.string().default(""),
  TOTP_ENCRYPTION_SECRET: z.string().min(32, "TOTP_ENCRYPTION_SECRET debe tener al menos 32 caracteres."),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  DEMO_GUEST_MODE: z.enum(["true", "false"]).default("false")
});

const parsed = envSchema.parse(process.env);
validateSigningSecrets(parsed.SESSION_SECRET, parsed.QR_SIGNING_SECRET, parsed.TOTP_ENCRYPTION_SECRET);
export const config = {
  ...parsed,
  DB_HOST: parsed.DB_HOST ?? databaseUrl?.hostname ?? "127.0.0.1",
  DB_PORT: parsed.DB_PORT ?? Number(databaseUrl?.port || 3306),
  DB_USER: parsed.DB_USER ?? (databaseUrl?.username ? decodeURIComponent(databaseUrl.username) : ""),
  DB_PASSWORD: parsed.DB_PASSWORD ?? (databaseUrl?.password ? decodeURIComponent(databaseUrl.password) : ""),
  DB_NAME: parsed.DB_NAME ?? (databaseUrl?.pathname ? decodeURIComponent(databaseUrl.pathname.slice(1)) : "basecomedorunca2026")
};

if (config.NODE_ENV === "production") {
  if (!config.DB_PASSWORD) throw new Error("DB_PASSWORD o una contraseña en DATABASE_URL es obligatoria en producción.");
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth debe estar configurado en producción.");
  }
  if (!config.APP_URL.startsWith("https://") || !config.GOOGLE_CALLBACK_URL.startsWith("https://")) {
    throw new Error("APP_URL y GOOGLE_CALLBACK_URL deben usar HTTPS en producción.");
  }
  if (config.DEMO_MODE === "true") throw new Error("DEMO_MODE debe permanecer desactivado en producción.");
  if (config.DEMO_GUEST_MODE === "true") throw new Error("DEMO_GUEST_MODE debe permanecer desactivado en producción.");
}

export const featureFlags = resolveFeatureFlags();
export const isDemoMode = config.NODE_ENV !== "production" && config.DEMO_MODE === "true";
export const isGuestDemoMode = config.NODE_ENV !== "production" && config.DEMO_GUEST_MODE === "true";

if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET &&
    new URL(config.APP_URL).hostname !== new URL(config.GOOGLE_CALLBACK_URL).hostname) {
  throw new Error("APP_URL y GOOGLE_CALLBACK_URL deben compartir hostname para conservar la sesión OAuth.");
}
