import { describe, expect, it } from "vitest";

import {
  BCRYPT_ROUNDS,
  checkPasswordPolicy,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "./password";

describe("checkPasswordPolicy", () => {
  it("accepts a long enough password", () => {
    expect(checkPasswordPolicy("correct horse battery")).toBeUndefined();
  });

  it("rejects short passwords", () => {
    expect(checkPasswordPolicy("short-pass1")).toMatch(/at least 12/);
  });

  it("rejects passwords bcrypt would truncate", () => {
    expect(checkPasswordPolicy("a".repeat(72))).toBeUndefined();
    expect(checkPasswordPolicy("a".repeat(73))).toMatch(/72 bytes/);
    // Multi-byte characters count by bytes, not characters.
    expect(checkPasswordPolicy("ñ".repeat(37))).toMatch(/72 bytes/);
  });

  it("rejects the email address as password", () => {
    expect(checkPasswordPolicy("Someone@Example.com", "someone@example.com")).toMatch(/email/);
  });
});

describe("password hashing", () => {
  it("hashes with bcrypt at the configured cost and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(new RegExp(`^\\$2[aby]\\$${BCRYPT_ROUNDS}\\$`));
    expect(hash).not.toContain("correct horse battery");
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong horse battery", hash)).resolves.toBe(false);
  });

  it("never matches when checking against the dummy hash", async () => {
    await expect(verifyAgainstDummy("passcode-dummy-password")).resolves.toBe(false);
  });
});
