// PRD §8 offboarding: a revoked person loses every way in on their very next
// request, even though their signed session cookie (JWT) hasn't expired.
// Route handlers and access checks run for real; only the session lookup and
// the model call are replaced.
import { clearTestDatabase } from "@/test/integration-db";

import { randomBytes } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.PASSCODE_ENCRYPTION_KEY = randomBytes(32).toString("base64");

// The JWT the browser still holds: whatever this variable says.
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; tokenVersion: number } },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("@/features/chat/chat-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/chat-service")>()),
  runChatTurn: async () => ({ reply: "model reached" }),
}));

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, PasswordRequest } = await import("@/lib/db/models");
const users = await import("./users");
const { authenticateCredentials } = await import("./login");
const { requireActionAccess, requirePageAccess, getSessionUser } = await import("./dal");
const { MockRouterAdapter } = await import("@/features/rotation/mock-router-adapter");
const { rotateNetworkPassword } = await import("@/features/rotation/rotation-service");
const { requestNetworkPassword } = await import("@/features/chat/password-access");
const meRoute = await import("@/app/api/me/route");
const chatRoute = await import("@/app/api/chat/route");
const adminUsersRoute = await import("@/app/api/admin/users/route");
type AuthorizedUser = import("./types").AuthorizedUser;

const PASSWORD = "correct horse battery";
let admin: AuthorizedUser;

function signInAs(user: { id: string }, tokenVersion = 0) {
  session.current = { user: { id: user.id, tokenVersion } };
}

const chat = () =>
  chatRoute.POST(
    new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "What's the password?" }] }),
    }),
  );
const me = () => meRoute.GET(new NextRequest("http://localhost/api/me"), undefined as never);
const listUsers = () =>
  adminUsersRoute.GET(new NextRequest("http://localhost/api/admin/users"), undefined as never);

/** The URL a page redirect points to (Next.js throws a special error). */
async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2];
  }
}

describe("offboarding: revocation takes effect everywhere at once (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    await clearTestDatabase();
    session.current = null;
    const a = await users.bootstrapAdmin({ email: "admin@example.com", password: PASSWORD });
    admin = { id: a.id, email: a.email, role: "ADMIN", tokenVersion: 0 };
    await rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() });
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectDb();
  });

  it("a revoked user loses the API, the chatbot, the password and sign-in", async () => {
    const user = await users.provisionUser(admin, {
      email: "leaver@example.com",
      password: PASSWORD,
    });
    signInAs(user);

    // Before: everything works.
    expect((await me()).status).toBe(200);
    const allowed = await chat();
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ reply: "model reached" });
    expect(await getSessionUser()).toMatchObject({ email: "leaver@example.com" });
    expect((await requestNetworkPassword({ userId: user.id, tokenVersion: 0 })).ok).toBe(true);

    await users.revokeUser(admin, user.id, "Moved out");

    // After: the same, still-valid session cookie gets nothing.
    expect((await me()).status).toBe(401);
    const denied = await chat();
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body).toMatchObject({ denied: "REVOKED" });
    expect(body.reply).toMatch(/revoked/i);
    expect(body).not.toHaveProperty("reveal");
    expect(await getSessionUser()).toBeNull();
    expect(await redirectTarget(() => requirePageAccess("user", "/chat"))).toBe(
      "/login?next=%2Fchat",
    );
    expect(await requireActionAccess("user", "/chat")).toMatchObject({ ok: false });
    expect(await requestNetworkPassword({ userId: user.id, tokenVersion: 0 })).toMatchObject({
      ok: false,
      reason: "REVOKED",
    });
    // A new sign-in is refused too, so there's no way to get a fresh session.
    expect(
      await authenticateCredentials({ email: "leaver@example.com", password: PASSWORD }),
    ).toEqual({
      ok: false,
      reason: "revoked",
    });
    // The chatbot attempt was logged for the admins.
    expect(
      await PasswordRequest.countDocuments({
        user: user.id,
        granted: false,
        denialReason: "REVOKED",
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("a revoked admin loses the admin app and admin API immediately", async () => {
    const other = await users.provisionUser(admin, {
      email: "second@example.com",
      password: PASSWORD,
      role: "ADMIN",
    });
    signInAs(other);
    expect(await redirectTarget(() => requirePageAccess("admin", "/admin/users"))).toBeNull();
    expect((await listUsers()).status).toBe(200);
    expect(await requireActionAccess("admin", "/admin/users")).toMatchObject({
      email: "second@example.com",
    });

    await users.revokeUser(admin, other.id);

    expect(await redirectTarget(() => requirePageAccess("admin", "/admin/users"))).toBe(
      "/login?next=%2Fadmin%2Fusers",
    );
    expect((await listUsers()).status).toBe(401);
    expect(await requireActionAccess("admin", "/admin/users")).toEqual({
      ok: false,
      error: "Your session has ended. Sign in again.",
    });
  });

  it("demoting an admin ends their admin session too", async () => {
    const other = await users.provisionUser(admin, {
      email: "demoted@example.com",
      password: PASSWORD,
      role: "ADMIN",
    });
    signInAs(other);
    await users.changeUserRole(admin, other.id, "USER");
    expect((await listUsers()).status).toBe(401);

    // After signing in again they are a regular user: chat works, admin doesn't.
    signInAs(other, 1);
    expect((await chat()).status).toBe(200);
    expect((await listUsers()).status).toBe(403);
    expect(await redirectTarget(() => requirePageAccess("admin", "/admin"))).toBe("/?denied=admin");
  });

  it("visitors without a session get the fixed explanation and nothing else", async () => {
    session.current = null;
    const response = await chat();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ denied: "UNAUTHENTICATED" });
    expect((await me()).status).toBe(401);
    expect(await redirectTarget(() => requirePageAccess("admin", "/admin"))).toBe(
      "/login?next=%2Fadmin",
    );
  });
});
