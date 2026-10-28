import { describe, expect, it } from "vitest";
import {
  createRecoveryCodes, createTotpSecret, createTotpUri, decryptTotpSecret,
  encryptTotpSecret, hashRecoveryCode, matchesRecoveryCode, verifyTotp
} from "./totp";

const encryptionSecret = "local-test-encryption-secret-0123456789";

describe("TOTP security helpers", () => {
  it("verifies the RFC 6238 SHA-1 test vector with the supported time window", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotp(secret, "287082", 59_000)).toBe(1);
    expect(verifyTotp(secret, "000000", 59_000)).toBeNull();
  });

  it("encrypts TOTP secrets and rejects altered ciphertext", () => {
    const secret = createTotpSecret();
    const encrypted = encryptTotpSecret(secret, encryptionSecret);
    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted, encryptionSecret)).toBe(secret);
    const parts = encrypted.split(".");
    const ciphertext = parts[3] ?? "";
    const alteredCiphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    expect(() => decryptTotpSecret([...parts.slice(0, 3), alteredCiphertext].join("."), encryptionSecret)).toThrow();
  });

  it("creates one-use recovery codes that are stored as keyed hashes", () => {
    const [code] = createRecoveryCodes();
    expect(code).toBeDefined();
    const storedHash = hashRecoveryCode(code!, encryptionSecret);
    expect(storedHash).not.toContain(code!);
    expect(matchesRecoveryCode(code!.toLowerCase().replaceAll("-", ""), storedHash, encryptionSecret)).toBe(true);
    expect(matchesRecoveryCode("AAAA-BBBB-CCCC", storedHash, encryptionSecret)).toBe(false);
  });

  it("creates a compatible authenticator URI", () => {
    const uri = new URL(createTotpUri("ABC234", "admin@example.invalid"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe("ABC234");
    expect(uri.searchParams.get("issuer")).toBe("Comedor UNCA");
    expect(uri.searchParams.get("digits")).toBe("6");
  });
});
