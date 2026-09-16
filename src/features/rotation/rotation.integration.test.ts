import "@/test/integration-db";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Tests supply their own key; the real one is never needed.
const encryptionKey = randomBytes(32);
process.env.PASSCODE_ENCRYPTION_KEY = encryptionKey.toString("base64");

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, RotationEvent, RotationSettings } = await import("@/lib/db/models");
const { MockRouterAdapter, fingerprint } = await import("./mock-router-adapter");
const {
  RotationInProgressError,
  STALE_ROTATION_MS,
  failStaleRotations,
  getCurrentNetworkPassword,
  rotateNetworkPassword,
} = await import("./rotation-service");
const { runScheduledRotationCheck } = await import("./scheduler");

describe("rotation engine (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    for (const model of allModels) await model.deleteMany();
  });

  afterAll(async () => {
    for (const model of allModels) await model.deleteMany();
    await disconnectDb();
  });

  it("rotates: stores the password encrypted, logs the event and audits it", async () => {
    const adapter = new MockRouterAdapter();
    const result = await rotateNetworkPassword({ trigger: "MANUAL", source: "test", adapter });

    expect(result).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
    expect(result.manualApplicationRequired).toBe(false);

    const event = await RotationEvent.findById(result.eventId).select("+passwordCiphertext").lean();
    expect(event).toMatchObject({
      trigger: "MANUAL",
      status: "SUCCEEDED",
      adapter: "mock",
      attempts: 1,
      manualApplicationRequired: false,
    });
    expect(event?.completedAt).toBeInstanceOf(Date);
    expect(event?.passwordCiphertext).toMatch(/^v1:/);

    const current = await getCurrentNetworkPassword(encryptionKey);
    expect(current?.eventId).toBe(result.eventId);
    // The stored password is the one that was applied, and isn't stored in plaintext.
    expect(fingerprint(current!.password)).toBe(adapter.lastAppliedFingerprint);
    expect(event?.passwordCiphertext).not.toContain(current!.password);

    const audit = await AuditLog.findOne({ target: result.eventId }).lean();
    expect(audit).toMatchObject({
      action: "rotation.succeeded",
      metadata: { trigger: "MANUAL", source: "test", adapter: "mock", attempts: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain(current!.password);
  });

  it("uses the encryption key from the environment by default", async () => {
    await rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() });
    expect((await getCurrentNetworkPassword())?.password).toHaveLength(20);
  });

  it("retries once, then succeeds", async () => {
    const adapter = new MockRouterAdapter({ failFirst: 1 });
    const result = await rotateNetworkPassword({ trigger: "MANUAL", adapter, retryDelayMs: 0 });
    expect(result).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
  });

  it("marks the rotation FAILED after the retry and keeps the previous password current", async () => {
    await rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() });
    const before = await getCurrentNetworkPassword(encryptionKey);

    const adapter = new MockRouterAdapter({ alwaysFail: true });
    const result = await rotateNetworkPassword({ trigger: "MANUAL", adapter, retryDelayMs: 0 });

    expect(result).toEqual({
      eventId: expect.any(String),
      status: "FAILED",
      attempts: 2,
      errorMessage: "Virtual router: simulated failure",
    });
    expect(adapter.calls).toBe(2);
    expect(await RotationEvent.findById(result.eventId).lean()).toMatchObject({
      status: "FAILED",
      attempts: 2,
      errorMessage: "Virtual router: simulated failure",
    });
    expect(await AuditLog.countDocuments({ action: "rotation.failed" })).toBe(1);
    expect(await getCurrentNetworkPassword(encryptionKey)).toEqual(before);
  });

  it("refuses to start a second rotation while one is in progress", async () => {
    let release!: () => void;
    const slowAdapter = new MockRouterAdapter();
    const original = slowAdapter.applyPassword.bind(slowAdapter);
    slowAdapter.applyPassword = async (password) => {
      await new Promise<void>((resolve) => (release = resolve));
      return original(password);
    };

    const first = rotateNetworkPassword({ trigger: "SCHEDULED", adapter: slowAdapter });
    await expect.poll(() => RotationEvent.countDocuments({ status: "PENDING" })).toBe(1);

    await expect(
      rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() }),
    ).rejects.toBeInstanceOf(RotationInProgressError);

    release();
    await expect(first).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(await RotationEvent.countDocuments()).toBe(1);
  });

  it("clears rotations interrupted mid-way so they don't block future ones", async () => {
    const createdAt = new Date(Date.now() - STALE_ROTATION_MS - 1000);
    await RotationEvent.collection.insertOne({
      trigger: "SCHEDULED",
      adapter: "mock",
      status: "PENDING",
      attempts: 0,
      createdAt,
    });
    expect(await failStaleRotations()).toBe(1);
    expect(await RotationEvent.findOne().lean()).toMatchObject({
      status: "FAILED",
      errorMessage: expect.stringMatching(/interrupted/),
    });

    const result = await rotateNetworkPassword({
      trigger: "MANUAL",
      adapter: new MockRouterAdapter(),
    });
    expect(result.status).toBe("SUCCEEDED");
  });

  describe("scheduler check", () => {
    const adapter = () => new MockRouterAdapter();

    it("does nothing until rotation settings exist", async () => {
      await expect(runScheduledRotationCheck(new Date(), { adapter: adapter() })).resolves.toEqual({
        due: false,
        reason: "not-configured",
      });
      expect(await RotationEvent.countDocuments()).toBe(0);
    });

    it("rotates when due, then waits for the configured interval", async () => {
      await RotationSettings.create({ intervalValue: 6, intervalUnit: "HOURS" });
      const now = new Date();

      const first = await runScheduledRotationCheck(now, { adapter: adapter() });
      expect(first).toMatchObject({ due: true, result: { status: "SUCCEEDED" } });
      expect(await RotationEvent.findOne().lean()).toMatchObject({ trigger: "SCHEDULED" });
      expect(await AuditLog.findOne().lean()).toMatchObject({
        metadata: { source: "scheduler" },
      });

      await expect(runScheduledRotationCheck(now, { adapter: adapter() })).resolves.toEqual({
        due: false,
        reason: "not-yet-due",
      });

      const sevenHoursLater = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      await expect(
        runScheduledRotationCheck(sevenHoursLater, { adapter: adapter() }),
      ).resolves.toMatchObject({ due: true });
      expect(await RotationEvent.countDocuments({ status: "SUCCEEDED" })).toBe(2);
    });

    it("respects the disabled flag and backs off after a failure", async () => {
      await RotationSettings.create({ enabled: false });
      await expect(runScheduledRotationCheck(new Date(), { adapter: adapter() })).resolves.toEqual({
        due: false,
        reason: "disabled",
      });

      await RotationSettings.updateOne({}, { enabled: true });
      const failing = new MockRouterAdapter({ alwaysFail: true });
      const failed = await runScheduledRotationCheck(new Date(), {
        adapter: failing,
        retryDelayMs: 0,
      });
      expect(failed).toMatchObject({ due: true, result: { status: "FAILED" } });

      await expect(runScheduledRotationCheck(new Date(), { adapter: adapter() })).resolves.toEqual({
        due: false,
        reason: "retry-backoff",
      });
    });
  });
});
