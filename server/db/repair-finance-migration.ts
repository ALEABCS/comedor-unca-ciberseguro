import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { config } from "../config";

const migrationTag = "0022_lowly_ultimatum";
const migrationPath = path.join("server", "db", "migrations", `${migrationTag}.sql`);
const journalPath = path.join("server", "db", "migrations", "meta", "_journal.json");
const backupPath = process.env.FINANCE_BACKUP_PATH;
const expectedBackupHash = process.env.FINANCE_BACKUP_SHA256?.toLowerCase();
const financeTables = [
  "cash_receipts", "cash_shifts", "finance_adjustments", "payment_allocations", "payment_evidence", "payment_finance_events"
];

function requiredColumns(createStatement: string): string[] {
  return [...createStatement.matchAll(/^\s*`([^`]+)`/gm)].map((match) => match[1]!);
}

async function main() {
  if (!backupPath || !expectedBackupHash) {
    throw new Error("Definí FINANCE_BACKUP_PATH y FINANCE_BACKUP_SHA256 con los datos del respaldo verificado.");
  }
  const backupStats = statSync(backupPath);
  const backupHash = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
  if (backupStats.size <= 0 || backupHash !== expectedBackupHash) {
    throw new Error("El respaldo no coincide con el tamaño/hash esperado; no se aplicaron cambios.");
  }

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
  };
  const migrationEntry = journal.entries.find((entry) => entry.tag === migrationTag);
  if (!migrationEntry) throw new Error(`El diario no contiene ${migrationTag}.`);
  const previousEntry = journal.entries.find((entry) => entry.idx === migrationEntry.idx - 1);
  if (!previousEntry) throw new Error("No se encontró la migración previa esperada.");

  const migrationSql = readFileSync(migrationPath, "utf8");
  const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
  const migrationStatements = migrationSql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  const connection = await mysql.createConnection({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    charset: "utf8mb4",
    timezone: "Z",
    multipleStatements: false
  });
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT GET_LOCK('comedor_finance_migration_0022_repair', 10) AS acquired"
    );
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error("No se pudo bloquear la recuperación de la migración.");
    lockAcquired = true;

    const [appliedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1"
    );
    const applied = appliedRows[0];
    if (Number(applied?.createdAt) === migrationEntry.when) {
      if (String(applied.hash) !== migrationHash) throw new Error("La migración registrada no coincide con su hash local.");
      console.info("La migración financiera ya está registrada con el hash esperado.");
      return;
    }
    if (Number(applied?.createdAt) !== previousEntry.when) {
      throw new Error("La base no está en el punto previo esperado; no se reparó ni modificó ningún objeto.");
    }

    for (const tableName of financeTables) {
      if (!/^[a-z_]+$/.test(tableName)) throw new Error("Nombre de tabla inesperado.");
      const [tableRows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        [config.DB_NAME, tableName]
      );
      if (tableRows.length) {
        const [countRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${tableName}\``);
        if (Number(countRows[0]?.total ?? 0) !== 0) {
          throw new Error(`La tabla financiera ${tableName} ya contiene datos; no se modificó.`);
        }
      }
    }

    for (const statement of migrationStatements) {
      const createMatch = statement.match(/^CREATE TABLE `([^`]+)`/i);
      if (createMatch) {
        const tableName = createMatch[1]!;
        const [existingTables] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          [config.DB_NAME, tableName]
        );
        if (!existingTables.length) {
          await connection.query(statement);
        } else {
          const [columnRows] = await connection.execute<mysql.RowDataPacket[]>(
            "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            [config.DB_NAME, tableName]
          );
          const actualColumns = new Set(columnRows.map((row) => String(row.name)));
          const missingColumns = requiredColumns(statement).filter((column) => !actualColumns.has(column));
          if (missingColumns.length) throw new Error(`La tabla ${tableName} no tiene las columnas esperadas: ${missingColumns.join(", ")}.`);
        }
        continue;
      }

      const constraintMatch = statement.match(/^ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)`/i);
      if (constraintMatch) {
        const [, tableName, constraintName] = constraintMatch as [string, string, string];
        const [existingConstraints] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
          [config.DB_NAME, tableName, constraintName]
        );
        if (!existingConstraints.length) await connection.query(statement);
        continue;
      }

      const indexMatch = statement.match(/^CREATE INDEX `([^`]+)` ON `([^`]+)`/i);
      if (indexMatch) {
        const [, indexName, tableName] = indexMatch as [string, string, string];
        const [existingIndexes] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT INDEX_NAME FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
          [config.DB_NAME, tableName, indexName]
        );
        if (!existingIndexes.length) await connection.query(statement);
        continue;
      }
      throw new Error("La migración contiene una operación no permitida por el reparador.");
    }

    for (const tableName of financeTables) {
      const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        [config.DB_NAME, tableName]
      );
      if (!rows.length) throw new Error(`Falta la tabla financiera ${tableName}; el journal no fue actualizado.`);
    }

    await connection.execute(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [migrationHash, migrationEntry.when]
    );
    console.info(`Migración ${migrationTag} completada y registrada. Respaldo verificado: ${backupStats.size} bytes.`);
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK('comedor_finance_migration_0022_repair')"); } catch { /* connection closes below */ }
    }
    await connection.end();
  }
}

main().catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error(JSON.stringify({ level: "ERROR", event: "finance_migration_repair_failed", code, message }));
  process.exitCode = 1;
});