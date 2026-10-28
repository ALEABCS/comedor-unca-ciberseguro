import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual
} from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid Base32 secret.");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpStepAt(time: number): number {
  return Math.floor(time / 30_000);
}

function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, token: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const currentStep = totpStepAt(now);
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    const expected = Buffer.from(codeForStep(secret, step));
    const actual = Buffer.from(token);
    if (timingSafeEqual(expected, actual)) return step;
  }
  return null;
}

function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(`comedor-unca:${purpose}`, "utf8").digest();
}

export function encryptTotpSecret(secret: string, encryptionSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionSecret, "totp-encryption-v1"), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptTotpSecret(encrypted: string, encryptionSecret: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored TOTP secret has an unsupported format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(encryptionSecret, "totp-encryption-v1"), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const value = encodeBase32(randomBytes(8));
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
  });
}

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, "");
}

export function hashRecoveryCode(code: string, encryptionSecret: string): string {
  return createHmac("sha256", deriveKey(encryptionSecret, "recovery-code-hmac-v1"))
    .update(normalizeRecoveryCode(code), "utf8")
    .digest("hex");
}

export function matchesRecoveryCode(code: string, storedHash: string, encryptionSecret: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashRecoveryCode(code, encryptionSecret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createTotpUri(secret: string, account: string): string {
  const issuer = "Comedor UNCA";
  const label = `${issuer}:${account}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}
