const minimumSecretLength = 32;

export function validateSigningSecrets(sessionSecret: string, qrSigningSecret: string, totpEncryptionSecret?: string): void {
  const secrets = [sessionSecret, qrSigningSecret];
  if (secrets.some((secret) =>
    secret.length < minimumSecretLength ||
    secret.toLowerCase().startsWith("replace-with") ||
    secret.toLowerCase().includes("do-not-deploy")
  )) {
    throw new Error("SESSION_SECRET y QR_SIGNING_SECRET deben configurarse con al menos 32 caracteres aleatorios.");
  }
  if (sessionSecret === qrSigningSecret) {
    throw new Error("SESSION_SECRET y QR_SIGNING_SECRET deben ser diferentes.");
  }
  if (totpEncryptionSecret !== undefined) {
    if (totpEncryptionSecret.length < minimumSecretLength ||
        totpEncryptionSecret.toLowerCase().startsWith("replace-with") ||
        totpEncryptionSecret.toLowerCase().includes("do-not-deploy")) {
      throw new Error("TOTP_ENCRYPTION_SECRET debe configurarse con al menos 32 caracteres aleatorios.");
    }
    if (secrets.includes(totpEncryptionSecret)) {
      throw new Error("TOTP_ENCRYPTION_SECRET debe ser distinto de los demás secretos.");
    }
  }
}
