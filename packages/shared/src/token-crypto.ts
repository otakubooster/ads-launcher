import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for Meta tokens (docs/spec.md → Token and secrets). Server only.
 * Ciphertext is base64 of encrypted bytes followed by the 16-byte auth tag.
 */
const ALGORITHM = "aes-256-gcm";
const TAG_BYTES = 16;

export type EncryptedToken = { ciphertext: string; iv: string; last4: string };

function key(base64Key = process.env.TOKEN_ENCRYPTION_KEY) {
  if (!base64Key) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const k = Buffer.from(base64Key, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptToken(token: string, base64Key?: string): EncryptedToken {
  const trimmed = token.trim();
  if (trimmed.length < 20) throw new Error("That does not look like a Meta access token");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(base64Key), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: encrypted.toString("base64"), iv: iv.toString("base64"), last4: trimmed.slice(-4) };
}

export function decryptToken(ciphertext: string, iv: string, base64Key?: string): string {
  const data = Buffer.from(ciphertext, "base64");
  if (data.length <= TAG_BYTES) throw new Error("Token ciphertext is corrupt");
  const decipher = createDecipheriv(ALGORITHM, key(base64Key), Buffer.from(iv, "base64"));
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
