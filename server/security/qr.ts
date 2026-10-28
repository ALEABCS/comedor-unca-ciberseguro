import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

function signature(ticketId: string): Buffer {
  return createHmac("sha256", config.QR_SIGNING_SECRET).update(`comedor-unca:${ticketId}`).digest();
}

export function createQrPayload(ticketId: string): string {
  const encodedSignature = signature(ticketId).toString("base64url");
  return `unca:${ticketId}:${encodedSignature}`;
}

export function verifyQrPayload(payload: string): string | null {
  const match = /^unca:([0-9a-f-]{36}):([A-Za-z0-9_-]{43})$/i.exec(payload);
  if (!match) return null;
  const expected = signature(match[1]);
  const provided = Buffer.from(match[2], "base64url");
  return provided.length === expected.length && timingSafeEqual(expected, provided) ? match[1] : null;
}
