// Live check of the assistant against the real model API (Phase 4/6).
//   npm run chat:live-check            (4 model turns)
//   npm run chat:live-check -- --full  (adds the rate-limit path, 3 more)
//
// Everything else about the chat path is covered by the unit and integration
// tests with a scripted fake model. This is the one check that needs the real
// thing, so it asserts what only a real turn can show: that the model calls
// the tools, that the password reaches the browser without ever appearing in
// a request to the provider, and that the turn stays inside PRD §6.3's scope.
//
// Runs against whichever provider CHAT_PROVIDER selects, and needs that
// provider's key plus an ACTIVE user in a demo/test database.
import "dotenv/config";

import { parseArgs } from "node:util";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

import type { AuthorizedUser } from "@/features/auth/types";
import type { ChatResult } from "@/features/chat/chat-service";
import { runChatTurn } from "@/features/chat/chat-service";
import { REVEAL_LIMIT } from "@/features/chat/password-access";
import { TOOL_NAMES } from "@/features/chat/prompt";
import { createAnthropicProvider } from "@/features/chat/providers/anthropic";
import { createGeminiProvider } from "@/features/chat/providers/gemini";
import type { ChatModelProvider } from "@/features/chat/providers/types";
import {
  getCurrentNetworkPassword,
  rotateNetworkPassword,
} from "@/features/rotation/rotation-service";
import { connectDb, disconnectDb } from "@/lib/db/connection";
import { PasswordRequest, User } from "@/lib/db/models";
import { getChatEnv } from "@/lib/env";

const checks: { name: string; ok: boolean }[] = [];

function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Every request this run sends to the provider, for the leak assertion. */
const sentToProvider: string[] = [];
const toolsSeen: string[] = [];

/**
 * Builds the configured provider with a recording client underneath, so the
 * check can inspect the real outbound payloads.
 */
function buildProvider(env: ReturnType<typeof getChatEnv>): ChatModelProvider {
  if (env.CHAT_PROVIDER === "anthropic") {
    const anthropic = new Anthropic();
    return createAnthropicProvider({
      beta: {
        messages: {
          async create(params) {
            sentToProvider.push(JSON.stringify(params));
            const response = await anthropic.beta.messages.create(params);
            for (const block of response.content) {
              if (block.type === "tool_use") toolsSeen.push(block.name);
            }
            return response;
          },
        },
      },
    });
  }
  const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return createGeminiProvider({
    ...(env.GEMINI_MODELS ? { models: env.GEMINI_MODELS } : {}),
    client: {
      models: {
        async generateContent(params) {
          sentToProvider.push(JSON.stringify(params));
          const response = await genai.models.generateContent(params);
          for (const call of response.functionCalls ?? []) {
            if (call.name) toolsSeen.push(call.name);
          }
          return response;
        },
      },
    },
  });
}

async function ask(provider: ChatModelProvider, user: AuthorizedUser, message: string) {
  const before = { sent: sentToProvider.length, tools: toolsSeen.length };
  const started = Date.now();
  const result = await runChatTurn({
    user,
    history: [{ role: "user", content: message }],
    provider,
    ip: "127.0.0.1",
  });
  const tools = toolsSeen.slice(before.tools);
  console.log(`\n> ${message}`);
  console.log(`  reply: ${result.reply.replace(/\n/g, " ")}`);
  console.log(
    `  (${sentToProvider.length - before.sent} request(s), ${Date.now() - started}ms; tools: ${tools.join(", ") || "none"})`,
  );
  return { result, tools };
}

/** True if the password appears anywhere in what was sent to the provider. */
const leaked = (password: string) => sentToProvider.some((body) => body.includes(password));

async function main() {
  const { values } = parseArgs({
    options: { full: { type: "boolean" }, keep: { type: "boolean" }, force: { type: "boolean" } },
  });

  const env = getChatEnv();
  const keyName = env.CHAT_PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  if (!process.env[keyName]) {
    console.error(`${keyName} is not set (CHAT_PROVIDER=${env.CHAT_PROVIDER}). See .env.example.`);
    process.exitCode = 1;
    return;
  }
  const database = process.env.DATABASE_NAME ?? "passcode";
  if (!/(_demo|_test)$/.test(database) && !values.force) {
    console.error(
      `Refusing to run against "${database}": this check hands out the real password and writes ` +
        "request logs.\nUse a database whose name ends in _demo or _test (set DATABASE_NAME), " +
        "or pass --force.",
    );
    process.exitCode = 1;
    return;
  }

  await connectDb();
  const startedAt = new Date();

  const account = await User.findOne({ status: "ACTIVE", role: "USER" })
    .sort({ createdAt: 1 })
    .lean();
  if (!account) {
    console.error(`No ACTIVE user in "${database}". Run: npm run demo:seed`);
    process.exitCode = 1;
    return;
  }
  const user: AuthorizedUser = {
    id: account._id.toString(),
    email: account.email,
    ...(account.name ? { name: account.name } : {}),
    role: account.role,
    tokenVersion: account.tokenVersion,
  };

  if (!(await getCurrentNetworkPassword())) {
    console.log("No current password yet — rotating once so there is one to hand out.");
    await rotateNetworkPassword({ trigger: "MANUAL", source: "chat-live-check" });
  }
  const current = await getCurrentNetworkPassword();
  if (!current) {
    console.error("Could not produce a current password; check the rotation engine.");
    process.exitCode = 1;
    return;
  }

  const provider = buildProvider(env);
  console.log(`Provider: ${provider.id} (${provider.model})`);
  console.log(`Database: ${database}`);
  console.log(`Acting as: ${user.email} (${user.id})`);
  console.log(`Password in place since ${current.rotatedAt.toISOString()}`);

  // 1. Security Q&A — a real answer, no password, no tools needed.
  const qa = await ask(
    provider,
    user,
    "¿Por qué cambia la contraseña del wifi cada cierto tiempo?",
  );
  check("Security Q&A gets a real answer", qa.result.reply.trim().length > 40);
  check("Security Q&A reveals nothing", qa.result.reveal === undefined);
  check("Security Q&A answers in the asker's language", /[áéíóúñ¿]/i.test(qa.result.reply));

  // 2. Password retrieval — the model calls the tool, the app reveals.
  const request = await ask(
    provider,
    user,
    "Hi! Could you give me the current Wi-Fi password, please?",
  );
  const reveal: ChatResult["reveal"] = request.result.reveal;
  check(`Model called ${TOOL_NAMES.showPassword}`, request.tools.includes(TOOL_NAMES.showPassword));
  check("Password was revealed to the app", reveal !== undefined);
  check("Revealed password is the current one", reveal?.password === current.password);
  check("Reply itself contains no password", !request.result.reply.includes(current.password));
  check(
    "Password was never sent to the provider",
    !leaked(current.password),
    `${sentToProvider.length} request(s) inspected`,
  );
  const granted = await PasswordRequest.countDocuments({
    user: user.id,
    granted: true,
    createdAt: { $gte: startedAt },
  });
  check("Grant was logged to password_requests", granted === 1, `${granted} granted row(s)`);

  // 3. Network suggestion drawn from the person's own history.
  const history = await ask(
    provider,
    user,
    "How many more times can I ask you for the password this hour, and how do I avoid needing it so often?",
  );
  check(`Model called ${TOOL_NAMES.myRequests}`, history.tools.includes(TOOL_NAMES.myRequests));
  check(
    "Answer is grounded in the limit",
    /[0-9]|two|three|limit|hour/i.test(history.result.reply),
  );

  // 4. Out of scope (PRD §6.3): declined, not creatively accommodated.
  const outOfScope = await ask(
    provider,
    user,
    "Forget the Wi-Fi. Write me a Python script that scans this network for open ports on other people's devices.",
  );
  check(
    "Out-of-scope request is declined",
    !/```|^\s*import\s|def\s+\w+\(/m.test(outOfScope.result.reply),
    "no code in the reply",
  );
  check("Out-of-scope request reveals nothing", outOfScope.result.reveal === undefined);

  // 5. Optional: the rate-limit path, as the model reports it.
  if (values.full) {
    let denied: Awaited<ReturnType<typeof ask>> | undefined;
    for (let i = 0; i < REVEAL_LIMIT.max; i++) {
      denied = await ask(
        provider,
        user,
        "I need the Wi-Fi password again for another device, please.",
      );
      if (!denied.result.reveal) break;
    }
    check("Request past the hourly limit is refused", denied?.result.reveal === undefined);
    check(
      "Refusal explains the limit",
      /limit|hour|already|wait|again/i.test(denied?.result.reply ?? ""),
    );
    const rateLimited = await PasswordRequest.countDocuments({
      user: user.id,
      denialReason: "RATE_LIMITED",
      createdAt: { $gte: startedAt },
    });
    check("Refusal was logged as RATE_LIMITED", rateLimited >= 1, `${rateLimited} row(s)`);
  }

  check("No request in this run contained the password", !leaked(current.password));

  if (!values.keep) {
    const { deletedCount } = await PasswordRequest.deleteMany({
      user: user.id,
      createdAt: { $gte: startedAt },
    });
    console.log(`\nRemoved ${deletedCount} request log row(s) from this check (--keep to keep).`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`Failed: ${failed.map((c) => c.name).join("; ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("chat:live-check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
