// One chat turn (PRD §6.3). The caller must already have authorized the user;
// this module never decides who may use the chatbot.
//
// The model is reached through a provider seam (`./providers`), so switching
// vendors can't move the authorization gate or the tools out of our code.
import type { Types } from "mongoose";

import type { AuthorizedUser } from "@/features/auth/types";
import { describeSchedule } from "@/features/admin/format";
import { getRotationSettings, getRotationStatus } from "@/features/rotation/settings";
import { connectDb } from "@/lib/db/connection";
import { PasswordRequest } from "@/lib/db/models";
import { getChatEnv } from "@/lib/env";

import { type ChatHistory } from "./history";
import { REVEAL_LIMIT, requestNetworkPassword } from "./password-access";
import { buildSystemPrompt, CHAT_TOOLS, TOOL_NAMES } from "./prompt";
import type { ChatModelProvider, ToolOutcome } from "./providers/types";

export { chatHistorySchema, MAX_TURNS, MAX_MESSAGE_CHARS, type ChatHistory } from "./history";

const MAX_TOOL_ROUNDS = 5;

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
  provider: ChatModelProvider;
  ip?: string;
  now?: Date;
}): Promise<ChatResult> {
  const { user, provider } = options;
  const env = getChatEnv();
  const system = [
    buildSystemPrompt({
      ...(env.PASSCODE_NETWORK_NAME ? { networkName: env.PASSCODE_NETWORK_NAME } : {}),
      ...(env.PASSCODE_SUPPORT_CONTACT ? { supportContact: env.PASSCODE_SUPPORT_CONTACT } : {}),
    }),
    // User-entered text: quoted as data, not instructions.
    `The person's display name, as they entered it: ${JSON.stringify(user.name ?? "")}`,
  ].join("\n\n");

  const session = provider.start({ system, history: options.history, tools: CHAT_TOOLS });
  let reveal: ChatResult["reveal"];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await session.send();

    if (reply.type === "refusal") return { reply: REFUSAL_REPLY, reveal };

    if (reply.type === "text") {
      return { reply: reply.text || "Sorry, I don't have an answer for that.", reveal };
    }

    const results: ToolOutcome[] = [];
    for (const call of reply.calls) {
      const { text, granted } = await runTool(call.name, {
        user,
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.now ? { now: options.now } : {}),
        alreadyShown: reveal !== undefined,
      });
      if (granted) reveal = granted;
      results.push({ ...(call.id ? { id: call.id } : {}), name: call.name, text });
    }
    session.provideToolResults(results);
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
        { ...(context.ip ? { ip: context.ip } : {}), now },
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
