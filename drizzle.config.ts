import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim()
  ? new URL(process.env.DATABASE_URL.trim())
  : new URL("mysql://127.0.0.1:3306/basecomedorunca2026");
if (!["mysql:", "mysql2:"].includes(databaseUrl.protocol)) {
  throw new Error("DATABASE_URL debe usar el protocolo mysql:// o mysql2://.");
}

export default defineConfig({
  dialect: "mysql",
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dbCredentials: {
    host: process.env.DB_HOST || databaseUrl.hostname,
    port: Number(process.env.DB_PORT ?? (databaseUrl.port || 3306)),
    user: process.env.DB_USER || decodeURIComponent(databaseUrl.username),
    password: process.env.DB_PASSWORD || decodeURIComponent(databaseUrl.password),
    database: process.env.DB_NAME || decodeURIComponent(databaseUrl.pathname.slice(1))
  },
  strict: true,
  verbose: true
});
