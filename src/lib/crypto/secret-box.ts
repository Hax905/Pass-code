// Application-level encryption for secrets at rest (STYLES.md §2.5):
// AES-256-GCM with a random IV per value. The auth tag makes tampering with
// the stored ciphertext detectable — decryption fails instead of returning junk.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function assertKey(key: Buffer) {
  if (key.length !== KEY_BYTES) throw new Error(`Encryption key must be ${KEY_BYTES} bytes`);
}

/** Returns `v1:<iv>:<tag>:<ciphertext>` (base64 parts). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, ...[iv, tag, ciphertext].map((part) => part.toString("base64"))].join(":");
}

export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognized encrypted secret format");
  }
  const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered data; don't surface crypto internals.
    throw new Error("Could not decrypt secret (wrong key or corrupted data)");
  }
}
