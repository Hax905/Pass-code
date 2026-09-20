import { clearTestDatabase } from "@/test/integration-db";

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.PASSCODE_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, RotationEvent, RotationSettings } = await import("@/lib/db/models");
const users = await import("@/features/auth/users");
const { getAnomalies } = await import("@/features/admin/activity");
const { MockRouterAdapter } = await import("./mock-router-adapter");
const { getCurrentNetworkPassword, rotateNetworkPassword } = await import("./rotation-service");
const { runScheduledRotationCheck } = await import("./scheduler");
const settingsModule = await import("./settings");
type AuthorizedUser = import("@/features/auth/types").AuthorizedUser;

const SETTINGS = {
  enabled: true,
  intervalValue: 1,
  intervalUnit: "DAYS",
  windowStartMinute: null,
  windowEndMinute: null,
  timezone: "UTC",
} as const;
let admin: AuthorizedUser;
let second: AuthorizedUser;

describe("rotation edge cases (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    await clearTestDatabase();
    const a = await users.bootstrapAdmin({
      email: "admin@example.com",
      password: "correct horse battery",
    });
    const b = await users.bootstrapAdmin({
      email: "second@example.com",
      password: "correct horse battery",
    });
    admin = { id: a.id, email: a.email, role: "ADMIN", tokenVersion: 0 };
    second = { id: b.id, email: b.email, role: "ADMIN", tokenVersion: 0 };
  });

  afterEach(() => {
    delete process.env.VIRTUAL_ROUTER_FAILURE;
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectDb();
  });

  describe("settings edits racing scheduled rotations", () => {
    it("lets exactly one of two simultaneous edits win; the other is told to reload", async () => {
      const current = await settingsModule.saveRotationSettings(admin, SETTINGS, null);
      const results = await Promise.allSettled([
        settingsModule.saveRotationSettings(
          admin,
          { ...SETTINGS, intervalValue: 2 },
          current.version,
        ),
        settingsModule.saveRotationSettings(
          second,
          { ...SETTINGS, intervalValue: 3 },
          current.version,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        settingsModule.SettingsConflictError,
      );
      // The stored value and the audit trail agree on the winner.
      const stored = (await settingsModule.getRotationSettings())!;
      const audits = await AuditLog.find({ action: "rotation.settings_updated" }).lean();
      expect(audits).toHaveLength(2);
      expect([2, 3]).toContain(stored.intervalValue);
    }, 60_000);

    it("never rotates twice when scheduler ticks and settings saves overlap", async () => {
      let version = (await settingsModule.saveRotationSettings(admin, SETTINGS, null)).version;
      const adapter = () => new MockRouterAdapter();
      const ticks: Promise<unknown>[] = [];
      for (let i = 0; i < 6; i++) {
        // Several scheduler instances ticking at once...
        ticks.push(runScheduledRotationCheck(new Date(), { adapter: adapter() }));
        // ...while an admin keeps saving (valid) settings.
        const saved = await settingsModule.saveRotationSettings(
          admin,
          { ...SETTINGS, intervalValue: 1 + (i % 2) },
          version,
        );
        version = saved.version;
      }
      const outcomes = await Promise.all(ticks);
      expect(await RotationEvent.countDocuments({ status: "SUCCEEDED" })).toBe(1);
      expect(await RotationEvent.countDocuments({ status: "PENDING" })).toBe(0);
      expect(outcomes.filter((o) => (o as { due: boolean }).due)).toHaveLength(1);
      // The ticks that lost the race said so instead of rotating again.
      const skipped = outcomes.filter((o) => !(o as { due: boolean }).due) as { reason: string }[];
      expect(
        skipped.every((o) => ["not-yet-due", "in-progress", "superseded"].includes(o.reason)),
      ).toBe(true);
      expect(await getCurrentNetworkPassword()).not.toBeNull();
    }, 60_000);

    it("turning scheduling off stops the next tick", async () => {
      const saved = await settingsModule.saveRotationSettings(admin, SETTINGS, null);
      await settingsModule.saveRotationSettings(
        admin,
        { ...SETTINGS, enabled: false },
        saved.version,
      );
      await expect(
        runScheduledRotationCheck(new Date(), { adapter: new MockRouterAdapter() }),
      ).resolves.toEqual({
        due: false,
        reason: "disabled",
      });
      expect(await RotationEvent.countDocuments()).toBe(0);
      expect(await RotationSettings.countDocuments()).toBe(1);
    });
  });

  describe("virtual router failures", () => {
    it("a router that keeps failing shows up in the admin data, and the old password stays current", async () => {
      await rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() });
      const before = await getCurrentNetworkPassword();

      process.env.VIRTUAL_ROUTER_FAILURE = "always";
      const result = await rotateNetworkPassword({
        trigger: "MANUAL",
        triggeredBy: admin.id,
        retryDelayMs: 0,
      });

      expect(result).toMatchObject({
        status: "FAILED",
        attempts: 2,
        errorMessage: "Virtual router: simulated failure",
      });
      const status = await settingsModule.getRotationStatus();
      expect(status.lastEvent).toMatchObject({
        status: "FAILED",
        errorMessage: "Virtual router: simulated failure",
      });
      expect(status.lastSuccess?.id).not.toBe(result.eventId);
      const history = await settingsModule.listRotationEvents();
      expect(history[0]).toMatchObject({
        id: result.eventId,
        status: "FAILED",
        triggeredBy: { email: "admin@example.com" },
      });
      expect((await getAnomalies()).map((a) => a.title)).toContain(
        "The last password rotation failed",
      );
      expect(await getCurrentNetworkPassword()).toEqual(before);
      expect(await AuditLog.countDocuments({ action: "rotation.failed" })).toBe(1);
    });

    it("a router that fails once recovers on the automatic retry", async () => {
      process.env.VIRTUAL_ROUTER_FAILURE = "first-attempt";
      const result = await rotateNetworkPassword({ trigger: "MANUAL", retryDelayMs: 0 });
      expect(result).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
      expect(await getAnomalies()).toEqual([]);
    });

    it("the scheduler backs off after a failure and succeeds once the router is back", async () => {
      await settingsModule.saveRotationSettings(admin, SETTINGS, null);
      process.env.VIRTUAL_ROUTER_FAILURE = "always";
      const now = new Date();
      const failed = await runScheduledRotationCheck(now, { retryDelayMs: 0 });
      expect(failed).toMatchObject({ due: true, result: { status: "FAILED" } });
      await expect(runScheduledRotationCheck(new Date(now.getTime() + 60_000))).resolves.toEqual({
        due: false,
        reason: "retry-backoff",
      });

      delete process.env.VIRTUAL_ROUTER_FAILURE;
      const later = new Date(now.getTime() + 31 * 60_000);
      await expect(runScheduledRotationCheck(later)).resolves.toMatchObject({
        due: true,
        result: { status: "SUCCEEDED" },
      });
      expect(await getAnomalies()).toEqual([]);
    });
  });
});
