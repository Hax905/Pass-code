import "@/test/integration-db";

import { randomBytes } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.PASSCODE_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, PasswordRequest, User } = await import("@/lib/db/models");
const users = await import("@/features/auth/users");
const { MockRouterAdapter } = await import("@/features/rotation/mock-router-adapter");
const { getCurrentNetworkPassword, rotateNetworkPassword } =
  await import("@/features/rotation/rotation-service");
const { saveRotationSettings } = await import("@/features/rotation/settings");
const { REVEAL_LIMIT, requestNetworkPassword } = await import("./password-access");
const { resolveChatAccess } = await import("./access");
const { REFUSAL_REPLY, runChatTurn } = await import("./chat-service");
const { TOOL_NAMES } = await import("./prompt");
type AuthorizedUser = import("@/features/auth/types").AuthorizedUser;

const PASSWORD = "correct horse battery";
let admin: AuthorizedUser;
let alice: AuthorizedUser;
let ipCounter = 0;
const freshIp = () => `10.1.0.${++ipCounter}`;

/** A fake Claude: returns the scripted responses in order and records every request. */
function fakeClient(script: Array<Partial<Anthropic.Beta.BetaMessage>>) {
  const requests: string[] = [];
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let index = 0;
  return {
    requests,
    params,
    beta: {
      messages: {
        async create(p: Anthropic.Beta.MessageCreateParamsNonStreaming) {
          // Snapshot now: the service keeps appending to the same array.
          requests.push(JSON.stringify(p));
          params.push(JSON.parse(JSON.stringify(p)));
          const next = script[Math.min(index++, script.length - 1)];
          return {
            id: `msg_${index}`,
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
            ...next,
          } as unknown as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
}

const callTool = (name: string, id = "toolu_1"): Partial<Anthropic.Beta.BetaMessage> => ({
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "Let me check.", citations: null },
    { type: "tool_use", id, name, input: {} },
  ] as Anthropic.Beta.BetaContentBlock[],
});
const say = (text: string): Partial<Anthropic.Beta.BetaMessage> => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text, citations: null }] as Anthropic.Beta.BetaContentBlock[],
});

async function rotate() {
  return rotateNetworkPassword({ trigger: "MANUAL", adapter: new MockRouterAdapter() });
}

describe("chatbot (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    for (const model of allModels) await model.deleteMany();
    const a = await users.bootstrapAdmin({ email: "admin@example.com", password: PASSWORD });
    admin = { id: a.id, email: a.email, role: "ADMIN", tokenVersion: 0 };
    const u = await users.provisionUser(admin, {
      email: "alice@example.com",
      name: "Alice",
      password: PASSWORD,
    });
    alice = { id: u.id, email: u.email, name: "Alice", role: "USER", tokenVersion: 0 };
  });

  afterAll(async () => {
    for (const model of allModels) await model.deleteMany();
    await disconnectDb();
  });

  describe("access gate (before any prompt is built)", () => {
    it("lets active users with a current session in", async () => {
      const access = await resolveChatAccess({ userId: alice.id, tokenVersion: 0 }, {});
      expect(access).toEqual({ allowed: true, user: alice });
      expect(await PasswordRequest.countDocuments()).toBe(0);
    });

    it("refuses and logs visitors who aren't signed in", async () => {
      const ip = freshIp();
      const access = await resolveChatAccess(null, { ip });
      expect(access).toMatchObject({ allowed: false, reason: "UNAUTHENTICATED" });
      expect(await PasswordRequest.findOne().lean()).toMatchObject({
        granted: false,
        denialReason: "UNAUTHENTICATED",
        sourceIp: ip,
      });
    });

    it("refuses revoked users and stale sessions", async () => {
      await users.revokeUser(admin, alice.id);
      const revoked = await resolveChatAccess({ userId: alice.id, tokenVersion: 0 }, {});
      expect(revoked).toMatchObject({ allowed: false, reason: "REVOKED" });
      expect((await PasswordRequest.findOne().lean())?.user?.toString()).toBe(alice.id);

      const u = await users.provisionUser(admin, { email: "bob@example.com", password: PASSWORD });
      const stale = await resolveChatAccess({ userId: u.id, tokenVersion: 5 }, { ip: freshIp() });
      expect(stale).toMatchObject({ allowed: false, reason: "UNAUTHENTICATED" });
      const garbage = await resolveChatAccess(
        { userId: "nope", tokenVersion: 0 },
        { ip: freshIp() },
      );
      expect(garbage).toMatchObject({ allowed: false, reason: "UNAUTHENTICATED" });
    });

    it("stops logging a flood of anonymous attempts from one address", async () => {
      const ip = freshIp();
      for (let i = 0; i < 15; i++) {
        expect((await resolveChatAccess(null, { ip })).allowed).toBe(false);
      }
      expect(await PasswordRequest.countDocuments({ sourceIp: ip })).toBe(10);
    });
  });

  describe("password gate", () => {
    it("grants the current password and logs it", async () => {
      await rotate();
      const result = await requestNetworkPassword(
        { userId: alice.id, tokenVersion: 0 },
        { ip: "10.0.0.5" },
      );
      const current = await getCurrentNetworkPassword();
      expect(result).toEqual({
        ok: true,
        password: current!.password,
        rotatedAt: current!.rotatedAt,
      });
      const log = await PasswordRequest.findOne().lean();
      expect(log).toMatchObject({ granted: true, sourceIp: "10.0.0.5" });
      expect(JSON.stringify(log)).not.toContain(current!.password);
    });

    it(`allows ${REVEAL_LIMIT.max} grants per hour, then refuses with a retry time`, async () => {
      await rotate();
      const who = { userId: alice.id, tokenVersion: 0 };
      const start = new Date();
      for (let i = 0; i < REVEAL_LIMIT.max; i++) {
        expect((await requestNetworkPassword(who, { now: new Date(start.getTime() + i) })).ok).toBe(
          true,
        );
      }
      const limited = await requestNetworkPassword(who, { now: new Date(start.getTime() + 10) });
      expect(limited).toMatchObject({ ok: false, reason: "RATE_LIMITED" });
      const firstGrant = (await PasswordRequest.findOne({ granted: true })
        .sort({ createdAt: 1 })
        .lean())!;
      expect((limited as { retryAt: Date }).retryAt.getTime()).toBe(
        firstGrant.createdAt.getTime() + REVEAL_LIMIT.windowMs,
      );
      expect(await PasswordRequest.countDocuments({ denialReason: "RATE_LIMITED" })).toBe(1);

      // Other users have their own allowance.
      const bob = await users.provisionUser(admin, {
        email: "bob@example.com",
        password: PASSWORD,
      });
      expect((await requestNetworkPassword({ userId: bob.id, tokenVersion: 0 })).ok).toBe(true);
    });

    it("refuses a user revoked after the chat started, and stale sessions", async () => {
      await rotate();
      await users.revokeUser(admin, alice.id);
      expect(await requestNetworkPassword({ userId: alice.id, tokenVersion: 0 })).toEqual({
        ok: false,
        reason: "REVOKED",
      });
      await users.reinstateUser(admin, alice.id);
      expect(await requestNetworkPassword({ userId: alice.id, tokenVersion: 0 })).toEqual({
        ok: false,
        reason: "NOT_AUTHORIZED",
      });
      expect(await PasswordRequest.countDocuments({ granted: true })).toBe(0);
    });

    it("reports when no password exists yet, without logging a request", async () => {
      expect(await requestNetworkPassword({ userId: alice.id, tokenVersion: 0 })).toEqual({
        ok: false,
        reason: "NO_PASSWORD",
      });
      expect(await PasswordRequest.countDocuments()).toBe(0);
    });
  });

  describe("chat turn", () => {
    const history = [{ role: "user" as const, content: "What's the Wi-Fi password?" }];

    it("shows the password outside the model's view and logs the request", async () => {
      await rotate();
      const { password } = (await getCurrentNetworkPassword())!;
      const client = fakeClient([callTool(TOOL_NAMES.showPassword), say("It's shown below.")]);

      const result = await runChatTurn({ user: alice, history, client, ip: "10.0.0.9" });

      expect(result.reply).toBe("It's shown below.");
      expect(result.reveal?.password).toBe(password);
      expect(await PasswordRequest.countDocuments({ granted: true, user: alice.id })).toBe(1);
      // Nothing sent to the model contains the password.
      expect(client.requests).toHaveLength(2);
      for (const request of client.requests) expect(request).not.toContain(password);
      const toolResult = client.params[1].messages.at(-1)!;
      expect(JSON.stringify(toolResult)).toMatch(/Shown\..*don't know it/);
    });

    it("sends the expected request shape", async () => {
      const client = fakeClient([say("Hi!")]);
      await runChatTurn({ user: alice, history, client });
      const [params] = client.params;
      expect(params).toMatchObject({
        model: "claude-opus-5",
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        messages: history,
      });
      expect(params.tools?.map((t) => ("name" in t ? t.name : undefined))).toEqual(
        Object.values(TOOL_NAMES),
      );
      expect(JSON.stringify(params.system)).toContain(
        'display name, as they entered it: \\"Alice\\"',
      );
      expect(params).not.toHaveProperty("thinking");
    });

    it("tells the model about the limit instead of showing the password", async () => {
      await rotate();
      for (let i = 0; i < REVEAL_LIMIT.max; i++) {
        await requestNetworkPassword({ userId: alice.id, tokenVersion: 0 });
      }
      const client = fakeClient([callTool(TOOL_NAMES.showPassword), say("You've hit the limit.")]);
      const result = await runChatTurn({ user: alice, history, client });
      expect(result.reveal).toBeUndefined();
      expect(JSON.stringify(client.params[1].messages.at(-1))).toContain("Not shown");
    });

    it("never shows the password to a user revoked mid-conversation", async () => {
      await rotate();
      await users.revokeUser(admin, alice.id);
      const client = fakeClient([callTool(TOOL_NAMES.showPassword), say("Sorry.")]);
      const result = await runChatTurn({ user: alice, history, client });
      expect(result.reveal).toBeUndefined();
      expect(await PasswordRequest.findOne().lean()).toMatchObject({
        granted: false,
        denialReason: "REVOKED",
      });
    });

    it("shows the password at most once per turn", async () => {
      await rotate();
      const client = fakeClient([
        callTool(TOOL_NAMES.showPassword, "toolu_1"),
        callTool(TOOL_NAMES.showPassword, "toolu_2"),
        say("Done."),
      ]);
      const result = await runChatTurn({ user: alice, history, client });
      expect(result.reveal).toBeDefined();
      expect(await PasswordRequest.countDocuments({ granted: true })).toBe(1);
      expect(JSON.stringify(client.params[2].messages.at(-1))).toContain("already shown");
    });

    it("answers rotation and history questions with the person's own data only", async () => {
      await saveRotationSettings(
        admin,
        {
          enabled: true,
          intervalValue: 1,
          intervalUnit: "WEEKS",
          windowStartMinute: null,
          windowEndMinute: null,
          timezone: "UTC",
        },
        null,
      );
      await rotate();
      const { password } = (await getCurrentNetworkPassword())!;
      const bob = await users.provisionUser(admin, {
        email: "bob@example.com",
        password: PASSWORD,
      });
      await PasswordRequest.create([
        { user: alice.id, granted: true },
        { user: bob.id, granted: false, denialReason: "RATE_LIMITED" },
      ]);

      const client = fakeClient([
        callTool(TOOL_NAMES.rotationInfo, "toolu_a"),
        callTool(TOOL_NAMES.myRequests, "toolu_b"),
        say("Here you go."),
      ]);
      await runChatTurn({ user: alice, history, client });

      const rotationResult = JSON.stringify(client.params[1].messages.at(-1));
      expect(rotationResult).toContain("Every week (UTC)");
      const historyResult = JSON.stringify(client.params[2].messages.at(-1));
      expect(historyResult).toContain('\\"remainingThisHour\\":2');
      expect(historyResult).not.toContain("RATE_LIMITED");
      for (const request of client.requests) {
        expect(request).not.toContain(password);
        expect(request).not.toMatch(/v1:|ciphertext|bob@example/i);
      }
    });

    it("returns a fixed message when the model declines", async () => {
      await rotate();
      const client = fakeClient([{ stop_reason: "refusal", content: [] }]);
      expect(await runChatTurn({ user: alice, history, client })).toEqual({
        reply: REFUSAL_REPLY,
        reveal: undefined,
      });
    });

    it("gives up after a bounded number of tool rounds", async () => {
      const client = fakeClient([callTool(TOOL_NAMES.rotationInfo)]);
      const result = await runChatTurn({ user: alice, history, client });
      expect(result.reply).toMatch(/couldn't finish/);
      expect(client.requests).toHaveLength(5);
    });

    it("never trusts the stored user object over the database", async () => {
      await rotate();
      await User.updateOne({ _id: alice.id }, { $inc: { tokenVersion: 1 } });
      const client = fakeClient([callTool(TOOL_NAMES.showPassword), say("Sorry.")]);
      const result = await runChatTurn({ user: alice, history, client });
      expect(result.reveal).toBeUndefined();
    });
  });
});
