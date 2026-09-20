import { clearTestDatabase } from "@/test/integration-db";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, User } = await import("@/lib/db/models");
const { AccessDeniedError } = await import("./errors");
const { LOGIN_FAILURE_LIMIT, authenticateCredentials } = await import("./login");
const { authorizeSession } = await import("./session-guard");
const users = await import("./users");
type AuthorizedUser = import("./types").AuthorizedUser;

const PASSWORD = "correct horse battery";

async function createAdmin(email = "admin@example.com"): Promise<AuthorizedUser> {
  const admin = await users.bootstrapAdmin({ email, password: PASSWORD });
  return { id: admin.id, email: admin.email, role: "ADMIN", tokenVersion: 0 };
}

/** Logs in and returns what the JWT would carry. */
async function login(email: string, password = PASSWORD) {
  const result = await authenticateCredentials({ email, password });
  if (!result.ok) throw new Error(`login failed: ${result.reason}`);
  return { userId: result.user.id, tokenVersion: result.user.tokenVersion };
}

function denied(status: number, code: string) {
  return { name: AccessDeniedError.name, status, code };
}

describe("auth layer (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectDb();
  });

  describe("registration and provisioning", () => {
    it("self-registered users start PENDING and cannot log in until approved", async () => {
      const admin = await createAdmin();
      const user = await users.registerUser({ email: "New@Example.com", password: PASSWORD });
      expect(user).toMatchObject({ email: "new@example.com", status: "PENDING", role: "USER" });
      expect(user).not.toHaveProperty("passwordHash");

      await expect(
        authenticateCredentials({ email: "new@example.com", password: PASSWORD }),
      ).resolves.toEqual({ ok: false, reason: "pending" });

      await users.approveUser(admin, user.id);
      await expect(login("new@example.com")).resolves.toMatchObject({ userId: user.id });
      expect(await AuditLog.findOne({ action: "user.approved" }).lean()).toMatchObject({
        actor: expect.anything(),
        target: user.id,
      });
    });

    it("stores only a bcrypt hash", async () => {
      await users.registerUser({ email: "hash@example.com", password: PASSWORD });
      const stored = await User.findOne({ email: "hash@example.com" })
        .select("+passwordHash")
        .lean();
      expect(stored?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(JSON.stringify(await AuditLog.find().lean())).not.toContain(PASSWORD);
    });

    it("rejects weak passwords, invalid emails and duplicates", async () => {
      await expect(
        users.registerUser({ email: "weak@example.com", password: "short" }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        users.registerUser({ email: "not-an-email", password: PASSWORD }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await users.registerUser({ email: "dup@example.com", password: PASSWORD });
      await expect(
        users.registerUser({ email: "DUP@example.com", password: PASSWORD }),
      ).rejects.toMatchObject({ code: "email_taken" });
    });

    it("admins provision ACTIVE accounts; non-admins cannot", async () => {
      const admin = await createAdmin();
      const user = await users.provisionUser(admin, {
        email: "staff@example.com",
        password: PASSWORD,
        name: "Staff",
      });
      expect(user).toMatchObject({ status: "ACTIVE", role: "USER", name: "Staff" });
      await expect(login("staff@example.com")).resolves.toBeDefined();

      const notAdmin: AuthorizedUser = { ...admin, id: user.id, role: "USER" };
      await expect(
        users.provisionUser(notAdmin, { email: "x@example.com", password: PASSWORD }),
      ).rejects.toThrow(/admin/i);
    });

    it("only approves PENDING users", async () => {
      const admin = await createAdmin();
      const user = await users.provisionUser(admin, {
        email: "active@example.com",
        password: PASSWORD,
      });
      await expect(users.approveUser(admin, user.id)).rejects.toMatchObject({
        code: "invalid_status",
      });
      await expect(users.approveUser(admin, "not-an-id")).rejects.toMatchObject({
        code: "user_not_found",
      });
    });
  });

  describe("login", () => {
    it("succeeds with the right password and audits it", async () => {
      const admin = await createAdmin();
      const result = await authenticateCredentials(
        { email: " ADMIN@example.com ", password: PASSWORD },
        { ip: "10.0.0.5" },
      );
      expect(result).toEqual({
        ok: true,
        user: { id: admin.id, email: "admin@example.com", role: "ADMIN", tokenVersion: 0 },
      });
      expect(await AuditLog.findOne({ action: "auth.login.succeeded" }).lean()).toMatchObject({
        target: "admin@example.com",
        metadata: { ip: "10.0.0.5" },
      });
    });

    it("fails the same way for a wrong password and an unknown email", async () => {
      await createAdmin();
      await expect(
        authenticateCredentials({ email: "admin@example.com", password: "wrong password!" }),
      ).resolves.toEqual({ ok: false, reason: "invalid_credentials" });
      await expect(
        authenticateCredentials({ email: "nobody@example.com", password: PASSWORD }),
      ).resolves.toEqual({ ok: false, reason: "invalid_credentials" });
      await expect(authenticateCredentials({ email: 42, password: [] })).resolves.toEqual({
        ok: false,
        reason: "invalid_input",
      });
      expect(await AuditLog.countDocuments({ action: "auth.login.failed" })).toBe(2);
    });

    it(`locks an email for a while after ${LOGIN_FAILURE_LIMIT} failures`, async () => {
      await createAdmin();
      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
        await authenticateCredentials({ email: "admin@example.com", password: "wrong password!" });
      }
      // Even the right password is refused while locked.
      await expect(
        authenticateCredentials({ email: "admin@example.com", password: PASSWORD }),
      ).resolves.toEqual({ ok: false, reason: "too_many_attempts" });
      // Other accounts are unaffected.
      await users.registerUser({ email: "other@example.com", password: PASSWORD });
      await expect(
        authenticateCredentials({ email: "other@example.com", password: PASSWORD }),
      ).resolves.toEqual({ ok: false, reason: "pending" });
    });
  });

  describe("guards", () => {
    it("rejects requests without a session", async () => {
      await expect(authorizeSession(null, "user")).rejects.toMatchObject(
        denied(401, "unauthenticated"),
      );
      await expect(authorizeSession({}, "user")).rejects.toMatchObject(
        denied(401, "unauthenticated"),
      );
      await expect(
        authorizeSession({ userId: "garbage", tokenVersion: 0 }, "user"),
      ).rejects.toMatchObject(denied(401, "session_invalid"));
    });

    it("lets active users through and keeps them out of admin routes", async () => {
      const admin = await createAdmin();
      await users.provisionUser(admin, { email: "user@example.com", password: PASSWORD });
      const session = await login("user@example.com");

      await expect(authorizeSession(session, "user")).resolves.toMatchObject({
        email: "user@example.com",
        role: "USER",
      });
      await expect(
        authorizeSession(session, "admin", { path: "/api/admin/users" }),
      ).rejects.toMatchObject(denied(403, "forbidden"));
      expect(await AuditLog.findOne({ action: "auth.access_denied" }).lean()).toMatchObject({
        target: "/api/admin/users",
        metadata: { reason: "forbidden", required: "admin" },
      });

      await expect(
        authorizeSession(await login("admin@example.com"), "admin"),
      ).resolves.toMatchObject({ role: "ADMIN" });
    });

    it("rejects sessions of users that no longer exist", async () => {
      const admin = await createAdmin();
      const user = await users.provisionUser(admin, {
        email: "gone@example.com",
        password: PASSWORD,
      });
      const session = await login("gone@example.com");
      await User.deleteOne({ _id: user.id });
      await expect(authorizeSession(session, "user")).rejects.toMatchObject(
        denied(401, "session_invalid"),
      );
    });
  });

  describe("revocation takes effect immediately", () => {
    it("revoking invalidates the existing session, blocks login and is audited atomically", async () => {
      const admin = await createAdmin();
      const user = await users.provisionUser(admin, {
        email: "leaver@example.com",
        password: PASSWORD,
      });
      const session = await login("leaver@example.com");
      await expect(authorizeSession(session, "user")).resolves.toBeDefined();

      const revoked = await users.revokeUser(admin, user.id, "Left the building");
      expect(revoked).toMatchObject({ status: "REVOKED", revokedAt: expect.any(Date) });
      expect((await User.findById(user.id).lean())?.tokenVersion).toBe(1);
      expect(await AuditLog.findOne({ action: "user.revoked" }).lean()).toMatchObject({
        target: user.id,
        metadata: {
          email: "leaver@example.com",
          previousStatus: "ACTIVE",
          reason: "Left the building",
        },
      });

      // The still-unexpired JWT is refused on the very next request...
      await expect(authorizeSession(session, "user")).rejects.toMatchObject(
        denied(401, "session_invalid"),
      );
      // ...and even a forged token with the new version is refused because the status is REVOKED.
      await expect(authorizeSession({ ...session, tokenVersion: 1 }, "user")).rejects.toMatchObject(
        denied(401, "session_invalid"),
      );
      await expect(
        authenticateCredentials({ email: "leaver@example.com", password: PASSWORD }),
      ).resolves.toEqual({ ok: false, reason: "revoked" });
      await expect(users.revokeUser(admin, user.id)).rejects.toMatchObject({
        code: "invalid_status",
      });
    });

    it("rolls back when the audit entry can't be written", async () => {
      const admin = await createAdmin();
      const user = await users.provisionUser(admin, {
        email: "atomic@example.com",
        password: PASSWORD,
      });
      // Make the audit write fail after the user update has been made.
      const badAudit = AuditLog.schema.path("action");
      const originalValidators = [...badAudit.validators];
      badAudit.validate(() => false, "forced failure");
      try {
        await expect(users.revokeUser(admin, user.id)).rejects.toThrow(/forced failure/);
      } finally {
        badAudit.validators = originalValidators;
      }
      expect(await User.findById(user.id).lean()).toMatchObject({
        status: "ACTIVE",
        tokenVersion: 0,
      });
    });

    it("changing a role or resetting a password also ends existing sessions", async () => {
      const admin = await createAdmin();
      const user = await users.provisionUser(admin, {
        email: "promo@example.com",
        password: PASSWORD,
      });

      const before = await login("promo@example.com");
      const promoted = await users.changeUserRole(admin, user.id, "ADMIN");
      expect(promoted.role).toBe("ADMIN");
      await expect(authorizeSession(before, "admin")).rejects.toMatchObject(
        denied(401, "session_invalid"),
      );
      await expect(
        authorizeSession(await login("promo@example.com"), "admin"),
      ).resolves.toBeDefined();

      const beforeReset = await login("promo@example.com");
      await users.resetUserPassword(admin, user.id, "a brand new passphrase");
      await expect(authorizeSession(beforeReset, "user")).rejects.toMatchObject(
        denied(401, "session_invalid"),
      );
      await expect(
        authenticateCredentials({ email: "promo@example.com", password: PASSWORD }),
      ).resolves.toEqual({ ok: false, reason: "invalid_credentials" });
      await expect(login("promo@example.com", "a brand new passphrase")).resolves.toBeDefined();
      await expect(users.resetUserPassword(admin, user.id, "short")).rejects.toMatchObject({
        code: "invalid_input",
      });
    });

    it("protects against admins locking everyone out", async () => {
      const admin = await createAdmin();
      await expect(users.revokeUser(admin, admin.id)).rejects.toMatchObject({
        code: "cannot_modify_self",
      });
      await expect(users.changeUserRole(admin, admin.id, "USER")).rejects.toMatchObject({
        code: "cannot_modify_self",
      });

      // Two admins can remove each other only while another active admin remains.
      // Simulate a race: "second" was revoked while its request was in flight.
      const second = await createAdmin("second@example.com");
      await users.revokeUser(admin, second.id);
      const secondRecord = { ...second, tokenVersion: 1 };
      await expect(users.revokeUser(secondRecord, admin.id)).rejects.toMatchObject({
        code: "last_admin",
      });
      await expect(users.changeUserRole(secondRecord, admin.id, "USER")).rejects.toMatchObject({
        code: "last_admin",
      });
      expect(await User.findById(admin.id).lean()).toMatchObject({
        status: "ACTIVE",
        role: "ADMIN",
      });
    });
  });

  it("lists users without secrets", async () => {
    const admin = await createAdmin();
    await users.registerUser({ email: "listed@example.com", password: PASSWORD });
    const listed = await users.listUsers(admin);
    expect(listed.map((u) => u.email).sort()).toEqual(["admin@example.com", "listed@example.com"]);
    expect(JSON.stringify(listed)).not.toMatch(/passwordHash|tokenVersion/);
  });
});
