import { describe, expect, it } from "vitest";

import {
  DEFAULT_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  generatePassword,
} from "./password-generator";

describe("generatePassword", () => {
  it("uses the default length and every character class", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword();
      expect(password).toHaveLength(DEFAULT_PASSWORD_LENGTH);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!#$%&*+\-=?@^_~]/);
    }
  });

  it("excludes look-alike characters by default", () => {
    const sample = Array.from({ length: 200 }, () => generatePassword({ length: 63 })).join("");
    expect(sample).not.toMatch(/[Il1O0o]/);
  });

  it("only uses printable ASCII accepted by WPA passphrases, without quotes or spaces", () => {
    const sample = Array.from({ length: 200 }, () =>
      generatePassword({ excludeAmbiguous: false }),
    ).join("");
    expect(sample).toMatch(/^[\x21-\x7e]+$/);
    expect(sample).not.toMatch(/["'`\\ ]/);
  });

  it("respects disabled character classes", () => {
    const password = generatePassword({ length: 40, symbols: false, uppercase: false });
    expect(password).toMatch(/^[a-z0-9]+$/);
  });

  it("does not repeat passwords", () => {
    const passwords = new Set(Array.from({ length: 1000 }, () => generatePassword()));
    expect(passwords.size).toBe(1000);
  });

  it("rejects lengths outside the allowed range", () => {
    expect(() => generatePassword({ length: MIN_PASSWORD_LENGTH - 1 })).toThrow(RangeError);
    expect(() => generatePassword({ length: MAX_PASSWORD_LENGTH + 1 })).toThrow(RangeError);
    expect(() => generatePassword({ length: 20.5 })).toThrow(RangeError);
    expect(generatePassword({ length: MAX_PASSWORD_LENGTH })).toHaveLength(MAX_PASSWORD_LENGTH);
  });

  it("requires at least one character class", () => {
    expect(() =>
      generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    ).toThrow(/character class/);
  });
});
