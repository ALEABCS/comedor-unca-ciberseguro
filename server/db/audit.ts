import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export async function writeAudit(
  connection: PoolConnection,
  entry: {
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId?: string;
    outcome?: "SUCCESS" | "DENIED" | "FAILURE";
    metadata?: Record<string, string | number | boolean | null>;
  }
): Promise<void> {
  const metadata = { ...entry.metadata };
  if (entry.actorId && !metadata.actorRole) {
    const [actors] = await connection.execute<RowDataPacket[]>(
      "SELECT role FROM users WHERE id = ? LIMIT 1",
      [entry.actorId]
    );
    if (actors[0]?.role) metadata.actorRole = String(actors[0].role);
  }
  await connection.execute(
    `INSERT INTO audit_logs (id, actor_id, action, resource_type, resource_id, outcome, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), entry.actorId, entry.action, entry.resourceType, entry.resourceId ?? null,
      entry.outcome ?? "SUCCESS", Object.keys(metadata).length ? JSON.stringify(metadata) : null
    ]
  );
}
