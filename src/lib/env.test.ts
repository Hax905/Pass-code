import { describe, expect, it } from "vitest";

import { getServerEnv } from "@/lib/env";

describe("getServerEnv", () => {
  it("accepts mongodb:// and mongodb+srv:// URIs", () => {
    expect(
      getServerEnv({ DATABASE_URL: "mongodb://127.0.0.1:27017/netguard", NODE_ENV: "test" })
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
