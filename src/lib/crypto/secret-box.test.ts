import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";

const key = randomBytes(32);

describe("secret box", () => {
  it("round-trips a secret without storing it in plaintext", () => {
    const payload = encryptSecret("Wifi-Pa$$word-123", key);
    expect(payload).toMatch(/^v1:/);
    expect(payload).not.toContain("Wifi-Pa$$word-123");
    expect(decryptSecret(payload, key)).toBe("Wifi-Pa$$word-123");
  });

  it("uses a fresh IV for every encryption", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("fails with the wrong key", () => {
    const payload = encryptSecret("secret", key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow(/could not decrypt/i);
  });

  it("detects tampering", () => {
    const [version, iv, tag, ciphertext] = encryptSecret("secret", key).split(":");
    const bytes = Buffer.from(ciphertext, "base64");
    bytes[0] ^= 1;
    const tampered = [version, iv, tag, bytes.toString("base64")].join(":");
    expect(() => decryptSecret(tampered, key)).toThrow(/could not decrypt/i);
  });

  it("rejects malformed payloads and bad keys", () => {
    expect(() => decryptSecret("plaintext", key)).toThrow(/format/);
    expect(() => encryptSecret("secret", randomBytes(16))).toThrow(/32 bytes/);
  });
});
