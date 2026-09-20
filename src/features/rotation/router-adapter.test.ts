import { describe, expect, it } from "vitest";

import { MockRouterAdapter, fingerprint } from "./mock-router-adapter";
import { applyWithRetry } from "./rotation-service";
import { createRouterAdapter, type RouterAdapter } from "./router-adapter";

describe("MockRouterAdapter", () => {
  it("accepts the password like a router that applies it immediately", async () => {
    const adapter = new MockRouterAdapter();
    await expect(adapter.applyPassword("pw-1")).resolves.toEqual({
      manualApplicationRequired: false,
    });
    expect(adapter.calls).toBe(1);
    expect(adapter.lastAppliedFingerprint).toBe(fingerprint("pw-1"));
    expect(JSON.stringify(adapter)).not.toContain("pw-1");
  });

  it("can simulate failures", async () => {
    const flaky = new MockRouterAdapter({ failFirst: 1 });
    await expect(flaky.applyPassword("pw")).rejects.toThrow(/simulated/);
    await expect(flaky.applyPassword("pw")).resolves.toBeDefined();
    await expect(new MockRouterAdapter({ alwaysFail: true }).applyPassword("pw")).rejects.toThrow();
  });

  it("is what createRouterAdapter returns for 'mock'", () => {
    expect(createRouterAdapter("mock")).toBeInstanceOf(MockRouterAdapter);
  });

  it("can be told to fail for demos and tests", async () => {
    await expect(
      createRouterAdapter("mock", { failure: "off" }).applyPassword("pw"),
    ).resolves.toBeDefined();
    const always = createRouterAdapter("mock", { failure: "always" });
    await expect(always.applyPassword("pw")).rejects.toThrow(/simulated/);
    await expect(always.applyPassword("pw")).rejects.toThrow(/simulated/);
    const once = createRouterAdapter("mock", { failure: "first-attempt" });
    await expect(once.applyPassword("pw")).rejects.toThrow(/simulated/);
    await expect(once.applyPassword("pw")).resolves.toBeDefined();
  });
});

describe("applyWithRetry", () => {
  it("succeeds on the first attempt", async () => {
    const adapter = new MockRouterAdapter();
    await expect(applyWithRetry(adapter, "pw", { retryDelayMs: 0 })).resolves.toEqual({
      ok: true,
      attempts: 1,
      manualApplicationRequired: false,
    });
  });

  it("retries once after a failure", async () => {
    const adapter = new MockRouterAdapter({ failFirst: 1 });
    const outcome = await applyWithRetry(adapter, "pw", { retryDelayMs: 0 });
    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(adapter.calls).toBe(2);
  });

  it("gives up after the retry and reports the error", async () => {
    const adapter = new MockRouterAdapter({ alwaysFail: true });
    const outcome = await applyWithRetry(adapter, "pw", { retryDelayMs: 0 });
    expect(outcome).toEqual({
      ok: false,
      attempts: 2,
      errorMessage: "Virtual router: simulated failure",
    });
    expect(adapter.calls).toBe(2);
  });

  it("never puts the password in the error message", async () => {
    const leaky: RouterAdapter = {
      name: "mock",
      applyPassword: async (password) => {
        throw new Error(`router rejected "${password}"`);
      },
    };
    const outcome = await applyWithRetry(leaky, "s3cret-Pw!", { retryDelayMs: 0 });
    expect(outcome).toEqual({
      ok: false,
      attempts: 2,
      errorMessage: 'router rejected "[redacted]"',
    });
  });

  it("treats an unresponsive router as a failure", async () => {
    const hanging: RouterAdapter = { name: "mock", applyPassword: () => new Promise(() => {}) };
    const outcome = await applyWithRetry(hanging, "pw", { retryDelayMs: 0, timeoutMs: 20 });
    expect(outcome).toMatchObject({ ok: false, errorMessage: expect.stringMatching(/20 ms/) });
  });
});
