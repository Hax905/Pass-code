import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { getRotationEnv, getServerEnv } from "@/lib/env";

describe("getServerEnv", () => {
  it("accepts mongodb:// and mongodb+srv:// URIs", () => {
    expect(
      getServerEnv({ DATABASE_URL: "mongodb://127.0.0.1:27017/passcode", NODE_ENV: "test" })
        .NODE_ENV,
    ).toBe("test");
    expect(
      getServerEnv({ DATABASE_URL: "mongodb+srv://u:p@cluster0.example.net/", NODE_ENV: "test" })
        .DATABASE_URL,
    ).toMatch(/^mongodb\+srv:/);
  });

  it("rejects a missing or non-mongodb DATABASE_URL", () => {
    expect(() => getServerEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
    expect(() => getServerEnv({ DATABASE_URL: "postgresql://x", NODE_ENV: "test" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("does not leak the URI value in error messages", () => {
    expect(() =>
      getServerEnv({ DATABASE_URL: "https://user:hunter2@example.com", NODE_ENV: "test" }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("hunter2") }));
  });
});

describe("getRotationEnv", () => {
  const key = randomBytes(32).toString("base64");

  it("decodes the encryption key and applies defaults", () => {
    const env = getRotationEnv({ PASSCODE_ENCRYPTION_KEY: key, NODE_ENV: "test" });
    expect(env.PASSCODE_ENCRYPTION_KEY).toHaveLength(32);
    expect(env.ROUTER_ADAPTER).toBe("mock");
    expect(env.ROTATION_SCHEDULER_ENABLED).toBe(false);
  });

  it("requires a 32-byte key", () => {
    expect(() => getRotationEnv({ NODE_ENV: "test" })).toThrow(/PASSCODE_ENCRYPTION_KEY/);
    expect(() =>
      getRotationEnv({
        PASSCODE_ENCRYPTION_KEY: randomBytes(16).toString("base64"),
        NODE_ENV: "test",
      }),
    ).toThrow(/32 bytes/);
  });

  it("rejects unknown router adapters without echoing the key", () => {
    expect(() =>
      getRotationEnv({ PASSCODE_ENCRYPTION_KEY: key, ROUTER_ADAPTER: "cisco", NODE_ENV: "test" }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining(key) }));
  });
});
