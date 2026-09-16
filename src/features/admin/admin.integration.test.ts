import "dotenv/config";

import { randomBytes } from "node:crypto";

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Always use a separate database so tests can never touch real data.
process.env.DATABASE_NAME = "passcode_test";
process.env.PASSCODE_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, PasswordRequest, RotationEvent, RotationSettings, User } =
  await import("@/lib/db/models");
const users = await import("@/features/auth/users");
const { authenticateCredentials } = await import("@/features/auth/login");
const { authorizeSession } = await import("@/features/auth/session-guard");
const { MockRouterAdapter } = await import("@/features/rotation/mock-router-adapter");
const { revealCurrentPassword, rotateNetworkPassword } =
  await import("@/features/rotation/rotation-service");
const settingsModule = await import("@/features/rotation/settings");
const { ANOMALY_THRESHOLDS, getAnomalies, listPasswordRequests } = await import("./activity");
type AuthorizedUser = import("@/features/auth/types").AuthorizedUser;

const PASSWORD = "correct horse battery";
const SETTINGS = {
  enabled: true,
  intervalValue: 7,
  intervalUnit: "DAYS",
  windowStartMinute: null,
  windowEndMinute: null,
  timezone: "UTC",
} as const;

let admin: AuthorizedUser;

async function rotate(options: { fail?: boolean } = {}) {
  return rotateNetworkPassword({
    trigger: "MANUAL",
    triggeredBy: admin.id,
    adapter: new MockRouterAdapter({ alwaysFail: options.fail }),
    retryDelayMs: 0,
  });
}

describe("admin app services (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    for (const model of allModels) await model.deleteMany();
    const created = await users.bootstrapAdmin({ email: "admin@example.com", password: PASSWORD });
    admin = { id: created.id, email: created.email, role: "ADMIN", tokenVersion: 0 };
  });

  afterAll(async () => {
    for (const model of allModels) await model.deleteMany();
    await disconnectDb();
  });

  describe("rotation settings", () => {
    it("creates settings once, then updates them with version checks and audit entries", async () => {
      expect(await settingsModule.getRotationSettings()).toBeNull();

      const created = await settingsModule.saveRotationSettings(admin, SETTINGS, null);
      expect(created).toMatchObject({ ...SETTINGS, version: 0 });

      const updated = await settingsModule.saveRotationSettings(
        admin,
        {
          ...SETTINGS,
          intervalValue: 12,
          intervalUnit: "HOURS",
          windowStartMinute: 1320,
          windowEndMinute: 300,
          timezone: "America/Costa_Rica",
        },
        created.version,
      );
      expect(updated).toMatchObject({
        intervalValue: 12,
        intervalUnit: "HOURS",
        windowStartMinute: 1320,
        windowEndMinute: 300,
        timezone: "America/Costa_Rica",
      });
      expect(updated.version).toBeGreaterThan(created.version);

      // Removing the window clears it.
      const cleared = await settingsModule.saveRotationSettings(admin, SETTINGS, updated.version);
      expect(cleared).toMatchObject({ windowStartMinute: null, windowEndMinute: null });

      const audits = await AuditLog.find({ action: "rotation.settings_updated" })
        .sort({ createdAt: 1 })
        .lean();
      expect(audits).toHaveLength(3);
      expect(audits[0].metadata).toMatchObject({ before: null, after: SETTINGS });
      expect(audits[1].metadata).toMatchObject({
        before: { intervalValue: 7, intervalUnit: "DAYS" },
        after: { intervalValue: 12 },
      });
      expect(String(audits[1].actor)).toBe(admin.id);
      expect((await RotationSettings.findOne().lean())?.updatedBy?.toString()).toBe(admin.id);
    });

    it("refuses to overwrite a change made by someone else", async () => {
      const first = await settingsModule.saveRotationSettings(admin, SETTINGS, null);
      await settingsModule.saveRotationSettings(
        admin,
        { ...SETTINGS, intervalValue: 3 },
        first.version,
      );
      await expect(
        settingsModule.saveRotationSettings(
          admin,
          { ...SETTINGS, intervalValue: 9 },
          first.version,
        ),
      ).rejects.toBeInstanceOf(settingsModule.SettingsConflictError);
      // Two admins creating the settings at the same time.
      await RotationSettings.deleteMany();
      await settingsModule.saveRotationSettings(admin, SETTINGS, null);
      await expect(
        settingsModule.saveRotationSettings(admin, SETTINGS, null),
      ).rejects.toBeInstanceOf(settingsModule.SettingsConflictError);
      expect((await settingsModule.getRotationSettings())?.intervalValue).toBe(7);
    });

    it("validates the input", async () => {
      const bad = [
        { ...SETTINGS, intervalValue: 0 },
        { ...SETTINGS, intervalValue: 1.5 },
        { ...SETTINGS, intervalValue: 60, intervalUnit: "WEEKS" as const },
        { ...SETTINGS, windowStartMinute: 60 },
        { ...SETTINGS, windowStartMinute: 60, windowEndMinute: 1440 },
        { ...SETTINGS, timezone: "Mars/Olympus_Mons" },
      ];
      for (const input of bad) {
        await expect(settingsModule.saveRotationSettings(admin, input, null)).rejects.toThrow();
      }
      expect(await RotationSettings.countDocuments()).toBe(0);
      await expect(
        settingsModule.saveRotationSettings({ ...admin, role: "USER" }, SETTINGS, null),
      ).rejects.toThrow(/admin/i);
    });
  });

  describe("rotation status and history", () => {
    it("reports configuration, last success, last event and next due time", async () => {
      expect(await settingsModule.getRotationStatus()).toEqual({
        configured: false,
        enabled: false,
        inProgress: false,
        nextDueAt: undefined,
      });

      await settingsModule.saveRotationSettings(admin, { ...SETTINGS, intervalValue: 2 }, null);
      const status = await settingsModule.getRotationStatus();
      expect(status).toMatchObject({ configured: true, enabled: true, inProgress: false });
      expect(status.nextDueAt!.getTime()).toBeLessThanOrEqual(Date.now());

      const success = await rotate();
      await rotate({ fail: true });
      const after = await settingsModule.getRotationStatus();
      expect(after.lastSuccess?.id).toBe(success.eventId);
      expect(after.lastEvent?.status).toBe("FAILED");
      const expectedDue = after.lastSuccess!.createdAt.getTime() + 2 * 24 * 60 * 60 * 1000;
      expect(after.nextDueAt?.getTime()).toBe(expectedDue);
    });

    it("lists history with who triggered it and never the password", async () => {
      await rotate();
      await rotate({ fail: true });
      const events = await settingsModule.listRotationEvents();
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        status: "FAILED",
        attempts: 2,
        errorMessage: "Mock router: simulated failure",
        triggeredBy: { id: admin.id, email: "admin@example.com" },
      });
      expect(events[1]).toMatchObject({ status: "SUCCEEDED", manualApplicationRequired: true });
      expect(JSON.stringify(events)).not.toMatch(/ciphertext|v1:/i);
    });
  });

  describe("revealing the password", () => {
    it("audits every reveal, including when there is no password yet", async () => {
      expect(await revealCurrentPassword(admin, { source: "test" })).toBeNull();
      await rotate();
      const shown = await revealCurrentPassword(admin, { source: "test" });
      expect(shown?.password).toHaveLength(20);

      const audits = await AuditLog.find({ action: /^password\.view/ })
        .sort({ createdAt: 1 })
        .lean();
      expect(audits.map((a) => a.action)).toEqual(["password.view_empty", "password.viewed"]);
      expect(audits[1]).toMatchObject({ target: shown!.eventId, metadata: { source: "test" } });
      expect(JSON.stringify(audits)).not.toContain(shown!.password);
    });

    it("is refused to non-admins", async () => {
      await rotate();
      await expect(revealCurrentPassword({ ...admin, role: "USER" })).rejects.toThrow(/admin/i);
      expect(await AuditLog.countDocuments({ action: "password.viewed" })).toBe(0);
    });
  });

  describe("reinstating users", () => {
    it("restores access for a revoked user without reviving old sessions", async () => {
      const user = await users.provisionUser(admin, {
        email: "back@example.com",
        password: PASSWORD,
      });
      const login = await authenticateCredentials({
        email: "back@example.com",
        password: PASSWORD,
      });
      if (!login.ok) throw new Error("login failed");
      const oldSession = { userId: login.user.id, tokenVersion: login.user.tokenVersion };

      await users.revokeUser(admin, user.id);
      await expect(users.reinstateUser(admin, admin.id)).rejects.toMatchObject({
        code: "invalid_status",
      });
      const reinstated = await users.reinstateUser(admin, user.id);
      expect(reinstated.status).toBe("ACTIVE");
      expect(reinstated).not.toHaveProperty("revokedAt");

      await expect(authorizeSession(oldSession, "user")).rejects.toMatchObject({ status: 401 });
      const again = await authenticateCredentials({
        email: "back@example.com",
        password: PASSWORD,
      });
      expect(again.ok).toBe(true);
      expect(await AuditLog.countDocuments({ action: "user.reinstated", target: user.id })).toBe(1);
      expect((await User.findById(user.id).lean())?.tokenVersion).toBe(2);
    });
  });

  describe("password request log and anomalies", () => {
    it("lists requests with the requester's email, newest first, and filters them", async () => {
      const user = await users.provisionUser(admin, {
        email: "asker@example.com",
        password: PASSWORD,
      });
      await PasswordRequest.create({ user: user.id, granted: true, sourceIp: "10.0.0.2" });
      await PasswordRequest.create({ granted: false, denialReason: "UNAUTHENTICATED" });

      const all = await listPasswordRequests();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ granted: false, denialReason: "UNAUTHENTICATED" });
      expect(all[0]).not.toHaveProperty("user");
      expect(all[1]).toMatchObject({
        granted: true,
        sourceIp: "10.0.0.2",
        user: { id: user.id, email: "asker@example.com" },
      });
      expect(await listPasswordRequests({ granted: true })).toHaveLength(1);
      expect(await listPasswordRequests({ granted: false })).toHaveLength(1);
    });

    it("is quiet when nothing is wrong", async () => {
      expect(await getAnomalies()).toEqual([]);
    });

    it("flags heavy requesters, denial and login spikes, failed rotations and pending work", async () => {
      const heavy = await users.provisionUser(admin, {
        email: "heavy@example.com",
        password: PASSWORD,
      });
      const normal = await users.provisionUser(admin, {
        email: "normal@example.com",
        password: PASSWORD,
      });
      await PasswordRequest.insertMany([
        ...Array.from({ length: ANOMALY_THRESHOLDS.userRequestsPerDay + 1 }, () => ({
          user: heavy.id,
          granted: true,
        })),
        ...Array.from({ length: ANOMALY_THRESHOLDS.userRequestsPerDay }, () => ({
          user: normal.id,
          granted: true,
        })),
        ...Array.from({ length: ANOMALY_THRESHOLDS.deniedRequestsPerHour }, () => ({
          granted: false,
          denialReason: "UNAUTHENTICATED",
        })),
      ]);
      await AuditLog.insertMany(
        Array.from({ length: ANOMALY_THRESHOLDS.failedLoginsPerHour }, () => ({
          action: "auth.login.failed",
          target: "someone@example.com",
        })),
      );
      await rotate();
      await rotate({ fail: true });
      await users.registerUser({ email: "waiting@example.com", password: PASSWORD });

      const anomalies = await getAnomalies();
      const titles = anomalies.map((a) => a.title);
      expect(titles).toEqual([
        "The last password rotation failed",
        "Unusually many password requests",
        "Many denied password requests",
        "Many failed sign-ins",
        "Apply the current password on the router",
        "1 account waiting for approval",
      ]);
      expect(anomalies[1].detail).toContain("heavy@example.com");
      expect(anomalies.map((a) => a.detail).join(" ")).not.toContain("normal@example.com");
    });

    it("ignores activity outside the time windows", async () => {
      const user = await users.provisionUser(admin, {
        email: "old@example.com",
        password: PASSWORD,
      });
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await PasswordRequest.collection.insertMany(
        Array.from({ length: 20 }, () => ({
          user: new mongoose.Types.ObjectId(user.id),
          granted: true,
          createdAt: twoDaysAgo,
        })),
      );
      await expect(getAnomalies()).resolves.toEqual([]);
      // A later successful rotation clears the "failed" alert.
      await rotate({ fail: true });
      await RotationEvent.collection.updateMany({}, { $set: { createdAt: twoDaysAgo } });
      await rotate();
      expect((await getAnomalies()).map((a) => a.title)).toEqual([
        "Apply the current password on the router",
      ]);
    });
  });
});
