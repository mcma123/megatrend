"use node";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConvexError } from "convex/values";
import { Secret, TOTP } from "otpauth";

export function mfaKey(
  keysJson: string | undefined,
  keyId: string | undefined,
) {
  try {
    const keys: unknown = JSON.parse(keysJson ?? "{}");
    const key =
      keys && typeof keys === "object" && keyId
        ? (keys as Record<string, unknown>)[keyId]
        : null;
    if (
      typeof key !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(key) ||
      !keyId ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)
    )
      throw new Error();
    return Buffer.from(key, "hex");
  } catch {
    throw new ConvexError("Signing MFA encryption is not configured correctly");
  }
}

export function encryptMfa(secret: string, key: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64",
  );
}

export function decryptMfa(encrypted: string, key: Buffer, context: string) {
  try {
    const bytes = Buffer.from(encrypted, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    decipher.setAAD(Buffer.from(context));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ConvexError(
      "Authenticator secret could not be read. Contact the administrator",
    );
  }
}

export function signingTotp(
  secret = new Secret({ size: 20 }).base32,
  label = "Administrator",
) {
  return new TOTP({
    issuer: "Cyphersoft Signing",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
}

export function recoveryCode() {
  return randomBytes(16).toString("hex");
}
