import "dotenv/config";
import mysql from "mysql2/promise";
import { getTableName } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { config } from "../config";
import { db, pool } from "./index";
import * as schema from "./schema";
import { adoptLegacyBaseline } from "./adopt-legacy-baseline";

if (!config.DB_USER) {
  throw new Error("Configurá DB_USER o DATABASE_URL con el usuario indicado por tu instalación de XAMPP.");
}
if (!/^[A-Za-z0-9_]+$/.test(config.DB_NAME)) {
  throw new Error("DB_NAME solo puede contener letras, números y guiones bajos.");
}

const bootstrap = await mysql.createConnection({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  charset: "utf8mb4",
  multipleStatements: false
});

try {
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`
  );
} finally {
  await bootstrap.end();
}

try {
  const [existingTables] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [config.DB_NAME]
  );
  const hasMigrationJournal = existingTables.some((table) => table.name === "__drizzle_migrations");
  if (existingTables.length > 0 && !hasMigrationJournal) {
    const baseline = await adoptLegacyBaseline(
      pool,
      existingTables.map((table) => String(table.name)),
      config.DB_NAME
    );
    console.info(`Esquema existente verificado contra ${baseline}; se registró su historial sin alterar sus tablas.`);
  }

  await migrate(db, { migrationsFolder: "./server/db/migrations" });

  const [tables] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [config.DB_NAME]
  );
  const actualTables = new Set(tables.map((table) => String(table.name)));
  const expectedTables = Object.values(schema).map((table) => getTableName(table));
  const missing = expectedTables.filter((table) => !actualTables.has(table));
  if (missing.length > 0) {
    throw new Error(`La migración terminó, pero faltan tablas requeridas: ${missing.join(", ")}.`);
  }
  console.info(`Migraciones Drizzle aplicadas y ${expectedTables.length} tablas verificadas en ${config.DB_NAME}.`);
} finally {
  await pool.end();
}
