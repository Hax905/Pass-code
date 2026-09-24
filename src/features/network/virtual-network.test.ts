import { describe, expect, it } from "vitest";

import { connectInputSchema, samePassword } from "./virtual-network";

describe("samePassword", () => {
  it("accepts only an exact match", () => {
    expect(samePassword("Correct-Horse-42", "Correct-Horse-42")).toBe(true);
    expect(samePassword("Correct-Horse-42", "correct-horse-42")).toBe(false);
    expect(samePassword("Correct-Horse-42", "Correct-Horse-43")).toBe(false);
  });

  it("compares different lengths without throwing", () => {
    // timingSafeEqual rejects unequal buffer lengths, which is why the values
    // are hashed first — a length mismatch must be a plain `false`, not a crash
    // (and must not be distinguishable by how long the comparison took).
    expect(samePassword("", "Correct-Horse-42")).toBe(false);
    expect(samePassword("x".repeat(500), "Correct-Horse-42")).toBe(false);
    expect(samePassword("Correct-Horse-4", "Correct-Horse-42")).toBe(false);
  });

  it("handles non-ASCII passwords by bytes", () => {
    expect(samePassword("pässwörd", "pässwörd")).toBe(true);
    expect(samePassword("pässwörd", "password")).toBe(false);
  });
});

describe("connectInputSchema", () => {
  it("trims the device name and requires both fields", () => {
    const parsed = connectInputSchema.parse({ deviceName: "  My phone  ", password: "secret" });
    expect(parsed.deviceName).toBe("My phone");

    expect(connectInputSchema.safeParse({ deviceName: "   ", password: "secret" }).success).toBe(
      false,
    );
    expect(connectInputSchema.safeParse({ deviceName: "Phone", password: "" }).success).toBe(false);
  });

  it("bounds the lengths", () => {
    expect(
      connectInputSchema.safeParse({ deviceName: "a".repeat(41), password: "secret" }).success,
    ).toBe(false);
    expect(
      connectInputSchema.safeParse({ deviceName: "Phone", password: "a".repeat(201) }).success,
    ).toBe(false);
  });
});
