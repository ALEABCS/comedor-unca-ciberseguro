import session from "express-session";
import type { SessionData } from "express-session";
import type { RowDataPacket } from "mysql2";
import { pool } from "./index";

type GetCallback = (error?: Error | null, value?: SessionData | null) => void;
type WriteCallback = (error?: Error | null) => void;

export type ActiveUserSession = {
  id: string;
  device: string;
  userAgent: string;
  ipPartial: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: number;
  current: boolean;
};

export class MySQLSessionStore extends session.Store {
  async listUserSessions(userId: string, currentSessionId: string): Promise<ActiveUserSession[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT session_id AS sessionId, expires, data FROM sessions
       WHERE expires > UNIX_TIMESTAMP()
         AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.passport.user')) = ?
       ORDER BY expires DESC`,
      [userId]
    );
    return rows.flatMap((row) => {
      const data: unknown = JSON.parse(String(row.data));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("La sesión almacenada tiene un formato inválido.");
      }
      const stored = data as SessionData & {
        sessionDevice?: string;
        sessionUserAgent?: string;
        sessionIpPartial?: string;
        sessionCreatedAt?: string;
        sessionLastActivityAt?: string;
      };
      const sid = String(row.sessionId);
      return [{
        id: sid,
        device: stored.sessionDevice ?? "Dispositivo no identificado",
        userAgent: stored.sessionUserAgent ?? "",
        ipPartial: stored.sessionIpPartial ?? "No disponible",
        createdAt: stored.sessionCreatedAt ?? "",
        lastActivityAt: stored.sessionLastActivityAt ?? "",
        expiresAt: Number(row.expires) * 1000,
        current: sid === currentSessionId
      }];
    });
  }

  get(sessionId: string, callback: GetCallback): void {
    void pool.execute<RowDataPacket[]>(
      "SELECT data, expires FROM sessions WHERE session_id = ? LIMIT 1",
      [sessionId]
    ).then(async ([rows]) => {
      const row = rows[0];
      if (!row) return callback(null, null);
      if (Number(row.expires) <= Math.floor(Date.now() / 1000)) {
        await pool.execute("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
        return callback(null, null);
      }
      const stored: unknown = JSON.parse(String(row.data));
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return callback(new Error("La sesión almacenada tiene un formato inválido."));
      }
      return callback(null, stored as SessionData);
    }).catch((error: Error) => callback(error));
  }

  set(sessionId: string, value: SessionData, callback: WriteCallback = () => undefined): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + (value.cookie.maxAge ?? 12 * 60 * 60 * 1000);
    const expires = Math.floor(expiresAt / 1000);
    if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000)) {
      callback(new Error("No se puede guardar una sesión expirada."));
      return;
    }
    void pool.execute(
      `INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sessionId, expires, JSON.stringify(value)]
    ).then(() => callback(null)).catch((error: Error) => callback(error));
  }

  destroy(sessionId: string, callback: WriteCallback = () => undefined): void {
    void pool.execute("DELETE FROM sessions WHERE session_id = ?", [sessionId])
      .then(() => callback(null))
      .catch((error: Error) => callback(error));
  }

  touch(sessionId: string, value: SessionData, callback: WriteCallback = () => undefined): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + (value.cookie.maxAge ?? 12 * 60 * 60 * 1000);
    const expires = Math.floor(expiresAt / 1000);
    void pool.execute("UPDATE sessions SET expires = ? WHERE session_id = ?", [expires, sessionId])
      .then(() => callback(null))
      .catch((error: Error) => callback(error));
  }

  close(): void {}
}

export const sessionStore = new MySQLSessionStore();
