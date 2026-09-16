import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import { isSameOrigin, jsonError } from "@/features/auth/route-guard";
import { resolveChatAccess } from "@/features/chat/access";
import { chatHistorySchema, runChatTurn } from "@/features/chat/chat-service";
import { userMessageLimiter } from "@/features/chat/rate-limit";
import { getChatEnv } from "@/lib/env";

const NO_STORE = { "Cache-Control": "no-store" };

let client: Anthropic | undefined;

/**
 * POST { messages: [{ role, content }, ...] } → { reply, reveal? }.
 * The password, when granted, is only in `reveal`; the model never sees it.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return jsonError(403, "cross_origin_request");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const env = getChatEnv();

  // 1. Who is asking: decided in code before any prompt exists.
  const session = await auth();
  const access = await resolveChatAccess(
    session && { userId: session.user?.id, tokenVersion: session.user?.tokenVersion },
    { ip, supportContact: env.PASSCODE_SUPPORT_CONTACT },
  );
  if (!access.allowed) {
    return Response.json(
      { reply: access.reply, denied: access.reason },
      { status: access.reason === "REVOKED" ? 403 : 401, headers: NO_STORE },
    );
  }

  // 2. How often: cost and abuse control, independent of the model.
  const limit = userMessageLimiter.hit(access.user.id);
  if (!limit.allowed) {
    return Response.json(
      {
        reply: "You're sending messages very quickly. Please wait a few minutes and try again.",
        retryAt: limit.retryAt,
      },
      { status: 429, headers: NO_STORE },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = chatHistorySchema.safeParse(
    body && typeof body === "object" && "messages" in body ? body.messages : undefined,
  );
  if (!parsed.success) {
    return jsonError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid messages");
  }

  try {
    client ??= new Anthropic();
    const result = await runChatTurn({ user: access.user, history: parsed.data, client, ip });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json(
        { reply: "The assistant is busy right now. Please try again in a minute." },
        { status: 503, headers: NO_STORE },
      );
    }
    // API failures, missing credentials (the SDK throws a plain Error for
    // those) and database errors: log the details, show a generic message.
    console.error("[chat] turn failed:", error instanceof Error ? error.message : error);
    return Response.json(
      { reply: "The assistant isn't available right now. Please try again later." },
      { status: 503, headers: NO_STORE },
    );
  }
}
