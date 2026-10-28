import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { config } from "../config";
import * as schema from "./schema";

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  connectionLimit: 10,
  timezone: "Z",
  charset: "utf8mb4",
  dateStrings: ["DATE"],
  multipleStatements: false,
  enableKeepAlive: true
});

export const db = drizzle(pool, { schema, mode: "default" });
