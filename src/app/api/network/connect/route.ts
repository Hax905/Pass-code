import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import { isSameOrigin, jsonError } from "@/features/auth/route-guard";
import { getOrCreateClientId } from "@/features/network/client-id";
import { connectDevice, connectInputSchema } from "@/features/network/virtual-network";

const NO_STORE = { "Cache-Control": "no-store" };

const MESSAGES = {
  WRONG_PASSWORD: "That isn't the current network password. Ask the assistant for the current one.",
  NO_PASSWORD: "The network has no password yet. An admin has to rotate once first.",
  ALREADY_CONNECTED: "That device is already on the network.",
  RATE_LIMITED: "Too many connection attempts. Please wait a few minutes and try again.",
} as const;

const STATUS = {
  WRONG_PASSWORD: 403,
  NO_PASSWORD: 409,
  ALREADY_CONNECTED: 409,
  RATE_LIMITED: 429,
} as const;

/**
 * POST { deviceName, password } → joins the virtual Wi-Fi.
 *
 * Open to visitors without an account on purpose: joining a Wi-Fi in real life
 * needs the password, not an identity, and PassCode's whole argument is that a
 * leaked password stops working at the next rotation. The attempt is rate
 * limited and logged either way, and this route never returns the password —
 * only whether the one supplied was right.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return jsonError(403, "cross_origin_request");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;

  const body: unknown = await request.json().catch(() => null);
  const parsed = connectInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid request");
  }

  const [client, session] = await Promise.all([getOrCreateClientId(), auth()]);
  const result = await connectDevice({
    ...parsed.data,
    client,
    // Attributed to the account when there is one, so the admin can tell an
    // approved person's device from one that got the password some other way.
    userId: session?.user?.id,
    ip,
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.reason,
        message: MESSAGES[result.reason],
        ...(result.reason === "RATE_LIMITED" ? { retryAt: result.retryAt } : {}),
      },
      { status: STATUS[result.reason], headers: NO_STORE },
    );
  }
  return Response.json({ device: result.device }, { headers: NO_STORE });
}
