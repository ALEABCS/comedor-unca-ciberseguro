import fs from "node:fs";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { readMigrationFiles } from "drizzle-orm/migrator";

const baselineMigration = "0003_robust_runaways";
const snapshotPath = "./server/db/migrations/meta/0003_snapshot.json";
const journalPath = "./server/db/migrations/meta/_journal.json";

type SnapshotColumn = {
  type: string;
  notNull: boolean;
  autoincrement: boolean;
  default?: string | boolean | number;
};

type SnapshotForeignKey = {
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
};

type SnapshotTable = {
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, { columns: string[]; isUnique: boolean }>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  compositePrimaryKeys: Record<string, { columns: string[] }>;
  uniqueConstraints: Record<string, { columns: string[] }>;
  checkConstraint: Record<string, { value: string }>;
};

type Snapshot = { tables: Record<string, SnapshotTable> };
type Journal = { entries: Array<{ tag: string }> };

const normalizeType = (type: string) => {
  const lower = type.toLowerCase().replace(/\s+/g, " ").trim();
  if (lower === "boolean") return "tinyint(1)";
  if (lower === "json") return "json";
  return lower.replace(/\b(int|integer|bigint|smallint|mediumint)\(\d+\)/g, "$1");
};

const normalizeDefault = (value: unknown) => {
  if (value === null || value === undefined || String(value).toLowerCase() === "null") return "";
  return String(value)
    .toLowerCase()
    .replace(/[()`\s]/g, "")
    .replace(/^now$/, "current_timestamp")
    .replace(/^true$/, "1")
    .replace(/^false$/, "0");
};

const normalizeCheck = (value: string) =>
  value
    .toLowerCase()
    .replace(/`[^`]+`\.`([^`]+)`/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, "");

const normalizeRule = (value: string) => value.toLowerCase().replace(/\s+/g, " ");

export async function adoptLegacyBaseline(pool: Pool, existingTableNames: string[], databaseName: string) {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Snapshot;
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  const migrations = readMigrationFiles({ migrationsFolder: "./server/db/migrations" });
  const baselineIndex = journal.entries.findIndex((entry) => entry.tag === baselineMigration);
  if (baselineIndex < 0 || !migrations[baselineIndex]) {
    throw new Error(`No se encontró la migración base ${baselineMigration}; no se modificó la base.`);
  }

  const expectedTables = Object.keys(snapshot.tables).sort();
  const actualTables = [...existingTableNames].sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `La base contiene tablas distintas de la línea base ${baselineMigration}; no se adoptó ni modificó el esquema.`
    );
  }

  const [columns] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
       IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault, EXTRA AS extra,
       COLLATION_NAME AS collationName
     FROM information_schema.columns WHERE TABLE_SCHEMA = ?`,
    [databaseName]
  );
  const [statistics] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
       SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName
     FROM information_schema.statistics WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [databaseName]
  );
  const [foreignKeyRows] = await pool.query<RowDataPacket[]>(
    `SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS constraintName, k.COLUMN_NAME AS columnName,
       k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
       k.ORDINAL_POSITION AS sequence, r.UPDATE_RULE AS updateRule, r.DELETE_RULE AS deleteRule
     FROM information_schema.key_column_usage k
     JOIN information_schema.referential_constraints r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [databaseName]
  );
  const [checkRows] = await pool.query<RowDataPacket[]>(
    `SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName, cc.CHECK_CLAUSE AS clause
     FROM information_schema.check_constraints cc
     JOIN information_schema.table_constraints tc
       ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`,
    [databaseName]
  );
  const issues: string[] = [];

  for (const [tableName, table] of Object.entries(snapshot.tables)) {
    const actualColumns = columns.filter((column) => column.tableName === tableName);
    if (actualColumns.length !== Object.keys(table.columns).length) {
      issues.push(`${tableName}: cantidad de columnas distinta`);
    }
    for (const [columnName, expected] of Object.entries(table.columns)) {
      const actual = actualColumns.find((column) => column.columnName === columnName);
      if (!actual) {
        issues.push(`${tableName}.${columnName}: falta columna`);
        continue;
      }
      let expectedType = normalizeType(expected.type.replace(/\s+COLLATE\s+\S+/i, ""));
      const actualType = normalizeType(String(actual.columnType));
      if (expectedType === "varchar(3)" && actualType === "char(3)" && columnName === "currency") {
        expectedType = actualType;
      }
      if (expectedType !== actualType && !(expectedType === "json" && actualType === "longtext")) {
        issues.push(`${tableName}.${columnName}: tipo incompatible`);
      }
      if (expected.type.toLowerCase().includes("collate ")) {
        const expectedCollation = expected.type.match(/collate\s+([a-z0-9_]+)/i)?.[1]?.toLowerCase();
        if (expectedCollation !== String(actual.collationName ?? "").toLowerCase()) {
          issues.push(`${tableName}.${columnName}: collation incompatible`);
        }
      }
      if (expected.notNull !== (actual.isNullable === "NO")) issues.push(`${tableName}.${columnName}: nullabilidad distinta`);
      if (expected.autoincrement !== String(actual.extra).toLowerCase().includes("auto_increment")) {
        issues.push(`${tableName}.${columnName}: autoincremento distinto`);
      }
      if (normalizeDefault(expected.default) !== normalizeDefault(actual.columnDefault)) {
        issues.push(`${tableName}.${columnName}: valor predeterminado distinto`);
      }
    }

    const tableIndexes = statistics.filter((entry) => entry.tableName === tableName);
    const actualIndexes = new Map<string, { unique: boolean; columns: string[] }>();
    for (const entry of tableIndexes) {
      const indexName = String(entry.indexName);
      const current = actualIndexes.get(indexName) ?? { unique: Number(entry.nonUnique) === 0, columns: [] };
      current.columns.push(String(entry.columnName));
      actualIndexes.set(indexName, current);
    }
    const expectedIndexes = [
      ...Object.values(table.indexes).map((index) => ({ unique: index.isUnique, columns: index.columns })),
      ...Object.values(table.uniqueConstraints).map((constraint) => ({ unique: true, columns: constraint.columns }))
    ];
    const expectedPrimaryKeys = Object.values(table.compositePrimaryKeys).map((key) => key.columns);
    const actualPrimaryKey = actualIndexes.get("PRIMARY")?.columns ?? [];
    if (JSON.stringify(expectedPrimaryKeys[0] ?? []) !== JSON.stringify(actualPrimaryKey)) {
      issues.push(`${tableName}: clave primaria distinta`);
    }
    const foreignKeyColumns = Object.values(table.foreignKeys).map((key) => key.columnsFrom.join(","));
    for (const expected of expectedIndexes) {
      if (!tableIndexes.some((entry) => {
        const actual = actualIndexes.get(String(entry.indexName));
        return actual?.unique === expected.unique && JSON.stringify(actual.columns) === JSON.stringify(expected.columns);
      })) {
        issues.push(`${tableName}: índice esperado ausente`);
      }
    }
    for (const [name, actual] of actualIndexes) {
      if (name === "PRIMARY" || expectedIndexes.some((expected) =>
        actual.unique === expected.unique && JSON.stringify(actual.columns) === JSON.stringify(expected.columns)
      )) continue;
      if (actual.unique || !foreignKeyColumns.includes(actual.columns.join(","))) {
        issues.push(`${tableName}.${name}: índice adicional no reconocido`);
      }
    }

    const expectedForeignKeys = Object.values(table.foreignKeys)
      .map((key) => `${key.columnsFrom.join(",")}->${key.tableTo}.${key.columnsTo.join(",")}:${normalizeRule(key.onDelete)}:${normalizeRule(key.onUpdate)}`)
      .sort();
    const actualForeignKeys = [...new Set(
      foreignKeyRows.filter((key) => key.tableName === tableName).map((key) => String(key.constraintName))
    )].map((name) => {
      const rows = foreignKeyRows
        .filter((key) => key.tableName === tableName && key.constraintName === name)
        .sort((left, right) => Number(left.sequence) - Number(right.sequence));
      const first = rows[0];
      const rule = (value: string) => normalizeRule(value).replace("restrict", "no action");
      return `${rows.map((row) => row.columnName).join(",")}->${first.referencedTable}.${rows.map((row) => row.referencedColumn).join(",")}:${rule(first.deleteRule)}:${rule(first.updateRule)}`;
    }).sort();
    if (JSON.stringify(expectedForeignKeys) !== JSON.stringify(actualForeignKeys)) {
      issues.push(`${tableName}: claves foráneas distintas`);
    }

    const expectedChecks = Object.entries(table.checkConstraint).map(([name, check]) => ({
      name,
      clause: normalizeCheck(check.value)
    }));
    const actualChecks = checkRows.filter((check) => check.tableName === tableName);
    for (const expected of expectedChecks) {
      const actual = actualChecks.find((check) => check.constraintName === expected.name);
      if (!actual || normalizeCheck(String(actual.clause)) !== expected.clause) {
        issues.push(`${tableName}.${expected.name}: restricción CHECK distinta`);
      }
    }
    for (const actual of actualChecks) {
      if (expectedChecks.some((expected) => expected.name === actual.constraintName)) continue;
      const jsonColumn = Object.entries(table.columns).some(
        ([name, column]) => column.type.toLowerCase() === "json" && name === actual.constraintName
      );
      if (!jsonColumn || !/^json_valid\(/i.test(String(actual.clause).replace(/`/g, ""))) {
        issues.push(`${tableName}.${String(actual.constraintName)}: CHECK adicional no reconocido`);
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `La base no coincide con la línea base Drizzle ${baselineMigration}; no se modificó ninguna tabla. ` +
      `Diferencias: ${issues.slice(0, 8).join("; ")}${issues.length > 8 ? "; ..." : ""}`
    );
  }

  const connection = await pool.getConnection();
  let journalCreated = false;
  try {
    await connection.query(
      `CREATE TABLE \`__drizzle_migrations\` (
         \`id\` serial PRIMARY KEY,
         \`hash\` text NOT NULL,
         \`created_at\` bigint
       )`
    );
    journalCreated = true;
    await connection.beginTransaction();
    for (const migration of migrations.slice(0, baselineIndex + 1)) {
      await connection.execute(
        "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        [migration.hash, migration.folderMillis]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (journalCreated) await connection.query("DROP TABLE `__drizzle_migrations`");
    throw error;
  } finally {
    connection.release();
  }
  return baselineMigration;
}
