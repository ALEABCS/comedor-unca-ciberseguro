import "dotenv/config";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config";

type TableRow = RowDataPacket & { name: string };
type ColumnRow = RowDataPacket & {
  tableName: string;
  columnName: string;
  isNullable: "YES" | "NO";
  columnDefault: string | null;
  extra: string;
};

const sourceName = process.env.LEGACY_DB_NAME?.trim();
const targetName = process.env.TARGET_DB_NAME?.trim() || config.DB_NAME;
const validDatabaseName = /^[A-Za-z0-9_]+$/;

if (!sourceName || !validDatabaseName.test(sourceName)) {
  throw new Error("Definí LEGACY_DB_NAME con el nombre válido de la base origen.");
}
if (!validDatabaseName.test(targetName) || sourceName === targetName) {
  throw new Error("El nombre de la base destino debe ser válido y distinto del origen.");
}

const connectionOptions = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  connectionLimit: 2,
  charset: "utf8mb4"
};
const source = mysql.createPool({ ...connectionOptions, database: sourceName });
const target = mysql.createPool({ ...connectionOptions, database: targetName });
const quoteIdentifier = (identifier: string) => `\`${identifier.replaceAll("`", "``")}\``;

try {
  const [sourceTables] = await source.execute<TableRow[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> '__drizzle_migrations'`,
    [sourceName]
  );
  const [targetTables] = await target.execute<TableRow[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [targetName]
  );
  const targetNames = new Set(targetTables.map((table) => table.name));
  const missingTables = sourceTables.map((table) => table.name).filter((name) => !targetNames.has(name));
  if (missingTables.length > 0) {
    throw new Error(`Faltan tablas en el destino: ${missingTables.join(", ")}. No se copiaron datos.`);
  }

  const [sourceColumns] = await source.execute<ColumnRow[]>(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, IS_NULLABLE AS isNullable,
       COLUMN_DEFAULT AS columnDefault, EXTRA AS extra
     FROM information_schema.columns WHERE TABLE_SCHEMA = ?`,
    [sourceName]
  );
  const [targetColumns] = await target.execute<ColumnRow[]>(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, IS_NULLABLE AS isNullable,
       COLUMN_DEFAULT AS columnDefault, EXTRA AS extra
     FROM information_schema.columns WHERE TABLE_SCHEMA = ?`,
    [targetName]
  );
  const tablePlans = sourceTables.map(({ name }) => {
    const sourceTableColumns = sourceColumns.filter((column) => column.tableName === name);
    const targetTableColumns = targetColumns.filter((column) => column.tableName === name);
    const targetColumnNames = new Set(targetTableColumns.map((column) => column.columnName));
    const missingColumns = sourceTableColumns.map((column) => column.columnName).filter((column) => !targetColumnNames.has(column));
    if (missingColumns.length > 0) {
      throw new Error(`${name}: faltan columnas de origen en destino (${missingColumns.join(", ")}). No se copiaron datos.`);
    }
    const sourceColumnNames = new Set(sourceTableColumns.map((column) => column.columnName));
    const unfillableColumns = targetTableColumns.filter((column) =>
      !sourceColumnNames.has(column.columnName) && column.isNullable === "NO" &&
      column.columnDefault === null && !column.extra.toLowerCase().includes("auto_increment")
    );
    if (unfillableColumns.length > 0) {
      throw new Error(`${name}: hay columnas obligatorias nuevas sin valor por defecto. No se copiaron datos.`);
    }
    return {
      name,
      columns: sourceTableColumns.map((column) => column.columnName)
    };
  });

  for (const { name } of targetTables) {
    if (name === "__drizzle_migrations") continue;
    const [rows] = await target.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(name)}`);
    if (Number(rows[0]?.total) !== 0) {
      throw new Error(`La tabla destino ${name} no está vacía. No se copió ningún dato.`);
    }
  }

  const sourceCounts = new Map<string, number>();
  for (const { name } of tablePlans) {
    const [rows] = await source.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(name)}`);
    sourceCounts.set(name, Number(rows[0]?.total));
  }

  const connection = await target.getConnection();
  const copiedRows: Array<{ table: string; rows: number }> = [];
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    await connection.beginTransaction();
    for (const { name, columns } of tablePlans) {
      const columnList = columns.map(quoteIdentifier).join(", ");
      const result = await connection.query(
        `INSERT INTO ${quoteIdentifier(targetName)}.${quoteIdentifier(name)} (${columnList})
         SELECT ${columnList} FROM ${quoteIdentifier(sourceName)}.${quoteIdentifier(name)}`
      );
      const rows = Number((result[0] as { affectedRows?: number }).affectedRows ?? 0);
      if (rows !== sourceCounts.get(name)) {
        throw new Error(`${name}: filas copiadas (${rows}) distintas del origen (${sourceCounts.get(name)}).`);
      }
      copiedRows.push({ table: name, rows });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    connection.release();
  }

  console.info(JSON.stringify({ source: sourceName, target: targetName, tables: copiedRows.length, copiedRows }));
} finally {
  await source.end();
  await target.end();
}