import { clearTestDatabase } from "@/test/integration-db";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.PASSCODE_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, PasswordRequest } = await import("@/lib/db/models");
const users = await import("@/features/auth/users");
const { MockRouterAdapter } = await import("@/features/rotation/mock-router-adapter");
const { rotateNetworkPassword } = await import("@/features/rotation/rotation-service");
const { REVEAL_LIMIT, requestNetworkPassword } = await import("./password-access");
const { SlidingWindowLimiter } = await import("./rate-limit");
type AuthorizedUser = import("@/features/auth/types").AuthorizedUser;

const PASSWORD = "correct horse battery";
const CONCURRENT = 20;
let admin: AuthorizedUser;

describe("rate limits under concurrent load (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    await clearTestDatabase();
    const a = await users.bootstrapAdmin({ email: "admin@example.com", password: PASSWORD });
    admin = { id: a.id, email: a.email, role: "ADMIN", tokenVersion: 0 };
    await rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() });
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectDb();
  });

  it(`grants exactly ${REVEAL_LIMIT.max} of ${CONCURRENT} simultaneous password requests`, async () => {
    const user = await users.provisionUser(admin, {
      email: "load@example.com",
      password: PASSWORD,
    });
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        requestNetworkPassword({ userId: user.id, tokenVersion: 0 }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(REVEAL_LIMIT.max);
    expect(results.filter((r) => !r.ok && r.reason === "RATE_LIMITED")).toHaveLength(
      CONCURRENT - REVEAL_LIMIT.max,
    );
    // Exactly one log entry per request, and the log agrees with the results.
    expect(await PasswordRequest.countDocuments({ user: user.id })).toBe(CONCURRENT);
    expect(await PasswordRequest.countDocuments({ user: user.id, granted: true })).toBe(
      REVEAL_LIMIT.max,
    );
  }, 120_000);

  it("keeps each user's allowance separate under load", async () => {
    const [alice, bob] = await Promise.all([
      users.provisionUser(admin, { email: "alice@example.com", password: PASSWORD }),
      users.provisionUser(admin, { email: "bob@example.com", password: PASSWORD }),
    ]);
    const results = await Promise.all(
      [alice, bob].flatMap((u) =>
        Array.from({ length: 8 }, () =>
          requestNetworkPassword({ userId: u.id, tokenVersion: 0 }).then((r) => ({ u, r })),
        ),
      ),
    );
    for (const u of [alice, bob]) {
      expect(results.filter((x) => x.u === u && x.r.ok)).toHaveLength(REVEAL_LIMIT.max);
    }
  }, 120_000);

  it("never grants anything to a user revoked while requests are in flight", async () => {
    const user = await users.provisionUser(admin, {
      email: "gone@example.com",
      password: PASSWORD,
    });
    const requests = Array.from({ length: 10 }, () =>
      requestNetworkPassword({ userId: user.id, tokenVersion: 0 }),
    );
    const revoke = users.revokeUser(admin, user.id);
    const [results] = await Promise.all([Promise.all(requests), revoke]);
    const revokedAt = (
      await PasswordRequest.find({ user: user.id, denialReason: "REVOKED" })
        .sort({ createdAt: 1 })
        .lean()
    )[0]?.createdAt;
    // Every grant happened before the first refusal caused by the revocation.
    const grants = await PasswordRequest.find({ user: user.id, granted: true }).lean();
    expect(grants.length).toBeLessThanOrEqual(REVEAL_LIMIT.max);
    if (revokedAt) {
      for (const g of grants)
        expect(g.createdAt.getTime()).toBeLessThanOrEqual(revokedAt.getTime());
    }
    expect(results.every((r) => r.ok || ["REVOKED", "RATE_LIMITED"].includes(r.reason))).toBe(true);
    // After the revocation completes, nothing more is granted.
    expect((await requestNetworkPassword({ userId: user.id, tokenVersion: 0 })).ok).toBe(false);
  }, 120_000);

  it("the in-memory message limiter admits exactly its limit for a burst", () => {
    const limiter = new SlidingWindowLimiter(20, 10 * 60 * 1000);
    const now = Date.now();
    const allowed = Array.from({ length: 500 }, () => limiter.hit("burst", now)).filter(
      (r) => r.allowed,
    );
    expect(allowed).toHaveLength(20);
  });
});
