// One chat turn (PRD §6.3). The caller must already have authorized the user;
// this module never decides who may use the chatbot.
import Anthropic from "@anthropic-ai/sdk";
import type { Types } from "mongoose";
import { z } from "zod";

import type { AuthorizedUser } from "@/features/auth/types";
import { describeSchedule } from "@/features/admin/format";
import { getRotationSettings, getRotationStatus } from "@/features/rotation/settings";
import { connectDb } from "@/lib/db/connection";
import { PasswordRequest } from "@/lib/db/models";
import { getChatEnv } from "@/lib/env";

import { REVEAL_LIMIT, requestNetworkPassword } from "./password-access";
import { buildSystemPrompt, CHAT_MODEL, CHAT_TOOLS, TOOL_NAMES } from "./prompt";

export const MAX_TURNS = 20;
export const MAX_MESSAGE_CHARS = 2000;
const MAX_TOOL_ROUNDS = 5;

// The browser sends plain text turns only. Tool calls and results are never
// accepted from the client, so a tampered history can't fake a tool result.
export const chatHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    }),
  )
  .min(1)
  .max(MAX_TURNS)
  .refine((turns) => turns.every((t, i) => t.role === (i % 2 === 0 ? "user" : "assistant")), {
    message: "Turns must alternate, starting with the user",
  })
  .refine((turns) => turns.at(-1)?.role === "user", {
    message: "The last turn must be from the user",
  });

export type ChatHistory = z.infer<typeof chatHistorySchema>;

/** The part of the Anthropic client this module uses (lets tests pass a fake). */
export interface ChatClient {
  beta: {
    messages: {
      create(
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
      ): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
}

export interface ChatResult {
  reply: string;
  /** Present only when the password gate granted access during this turn. */
  reveal?: { password: string; rotatedAt: Date };
}

export const REFUSAL_REPLY =
  "Sorry, I can't help with that. I can help you get the Wi-Fi password or answer questions about the building network.";

export async function runChatTurn(options: {
  user: AuthorizedUser;
  history: ChatHistory;
  client: ChatClient;
  ip?: string;
  now?: Date;
}): Promise<ChatResult> {
  const { user, client } = options;
  const env = getChatEnv();
  const messages: Anthropic.Beta.BetaMessageParam[] = options.history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  let reveal: ChatResult["reveal"];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: 16000,
      // Server-side fallback: a request declined by Claude Opus 5's safety
      // classifiers is retried on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Short conversational answers don't need deep reasoning.
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system: [
        {
          type: "text",
          text: buildSystemPrompt({
            networkName: env.PASSCODE_NETWORK_NAME,
            supportContact: env.PASSCODE_SUPPORT_CONTACT,
          }),
        },
        {
          type: "text",
          // User-entered text: quoted as data, not instructions.
          text: `The person's display name, as they entered it: ${JSON.stringify(user.name ?? "")}`,
        },
      ],
      tools: CHAT_TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") return { reply: REFUSAL_REPLY, reveal };

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      return { reply: text || "Sorry, I don't have an answer for that.", reveal };
    }

    // Keep thinking and tool_use blocks exactly as returned.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { text, granted } = await runTool(block.name, {
        user,
        ip: options.ip,
        now: options.now,
        alreadyShown: reveal !== undefined,
      });
      if (granted) reveal = granted;
      results.push({ type: "tool_result", tool_use_id: block.id, content: text });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    reply: reveal
      ? "Your password is shown below."
      : "Sorry, I couldn't finish that request. Please try again.",
    reveal,
  };
}

async function runTool(
  name: string,
  context: { user: AuthorizedUser; ip?: string; now?: Date; alreadyShown: boolean },
): Promise<{ text: string; granted?: ChatResult["reveal"] }> {
  const now = context.now ?? new Date();
  switch (name) {
    case TOOL_NAMES.showPassword: {
      if (context.alreadyShown) {
        return { text: "The password is already shown to the person in this turn." };
      }
      const result = await requestNetworkPassword(
        { userId: context.user.id, tokenVersion: context.user.tokenVersion },
        { ip: context.ip, now },
      );
      if (result.ok) {
        return {
          text: `Shown. The current password is now displayed to the person in a separate panel below your reply; you don't know it and must not write any password. It was last changed ${result.rotatedAt.toISOString()} (now is ${now.toISOString()}). The request was logged.`,
          granted: { password: result.password, rotatedAt: result.rotatedAt },
        };
      }
      switch (result.reason) {
        case "RATE_LIMITED":
          return {
            text: `Not shown: the person already got the password ${REVEAL_LIMIT.max} times in the last hour, which is the limit. They can ask again after ${result.retryAt.toISOString()} (now is ${now.toISOString()}). Suggest saving it on their devices.`,
          };
        case "NO_PASSWORD":
          return {
            text: "Not shown: no password has been generated yet. The person should contact the administrator.",
          };
        default:
          return {
            text: "Not shown: the person's access is no longer valid. Tell them to sign in again or contact the administrator.",
          };
      }
    }
    case TOOL_NAMES.rotationInfo: {
      const [status, settings] = await Promise.all([getRotationStatus(), getRotationSettings()]);
      return {
        text: JSON.stringify({
          now: now.toISOString(),
          passwordLastChanged: status.lastSuccess?.createdAt ?? null,
          automaticRotation: settings?.enabled ? describeSchedule(settings) : "off",
          nextChangeNotBefore: status.nextDueAt ?? null,
        }),
      };
    }
    case TOOL_NAMES.myRequests: {
      await connectDb();
      const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const requests = await PasswordRequest.find({
        user: context.user.id,
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean<
          { _id: Types.ObjectId; granted: boolean; denialReason?: string; createdAt: Date }[]
        >();
      const grantedLastHour = requests.filter(
        (r) => r.granted && r.createdAt.getTime() > now.getTime() - REVEAL_LIMIT.windowMs,
      ).length;
      return {
        text: JSON.stringify({
          now: now.toISOString(),
          last7Days: requests.map((r) => ({
            at: r.createdAt,
            granted: r.granted,
            ...(r.denialReason ? { reason: r.denialReason } : {}),
          })),
          remainingThisHour: Math.max(0, REVEAL_LIMIT.max - grantedLastHour),
        }),
      };
    }
    default:
      return { text: `Unknown tool: ${name}` };
  }
}
