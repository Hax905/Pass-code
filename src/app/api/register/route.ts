import type { NextRequest } from "next/server";

import { UserActionError } from "@/features/auth/errors";
import { isSameOrigin, jsonError } from "@/features/auth/route-guard";
import { registerUser } from "@/features/auth/users";

const ACCEPTED_MESSAGE = "Registration received. An administrator must approve your account.";

/** Public self-registration. The account stays PENDING until an admin approves it. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return jsonError(403, "cross_origin_request");

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return jsonError(400, "invalid_input", "Expected a JSON body");
  }
  const { email, password, name } = body as Record<string, unknown>;

  try {
    await registerUser({ email, password, name } as Parameters<typeof registerUser>[0]);
  } catch (error) {
    if (!(error instanceof UserActionError)) throw error;
    // Same answer for an existing email, so this endpoint can't be used to find accounts.
    if (error.code !== "email_taken") return jsonError(400, error.code, error.message);
  }
  return Response.json({ message: ACCEPTED_MESSAGE }, { status: 202 });
}
