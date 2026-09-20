// The only path that hands the network password to a user (PRD §6.3, Flow C).
// Authorization and rate limiting are deterministic code; the model only asks
// for the password on the user's behalf and never sees it.
import mongoose, { type ClientSession } from "mongoose";

import { connectDb } from "@/lib/db/connection";
import { PasswordRequest, User, type DENIAL_REASONS } from "@/lib/db/models";
import { getCurrentNetworkPassword } from "@/features/rotation/rotation-service";

export const REVEAL_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 } as const;

type DenialReason = (typeof DENIAL_REASONS)[number];

export type PasswordAccessResult =
  | { ok: true; password: string; rotatedAt: Date }
  | { ok: false; reason: "RATE_LIMITED"; retryAt: Date }
  | { ok: false; reason: Exclude<DenialReason, "RATE_LIMITED"> }
  | { ok: false; reason: "NO_PASSWORD" };

/** Logs a password request. Never stores the password itself. */
export async function logPasswordRequest(
  entry: {
    userId?: string;
    granted: boolean;
    denialReason?: DenialReason;
    ip?: string;
  },
  session?: ClientSession,
) {
  await connectDb();
  await PasswordRequest.create(
    [
      {
        user: entry.userId,
        granted: entry.granted,
        denialReason: entry.denialReason,
        sourceIp: entry.ip,
      },
    ],
    { session },
  );
}

/**
 * Gives the current password to `userId` if they are still an ACTIVE user with
 * the same session version and are under the rate limit. Every outcome except
 * "no password exists yet" is written to password_requests.
 *
 * Runs as one transaction that also writes the user's document: concurrent
 * requests for the same user conflict, MongoDB retries them one after another,
 * and the limit holds exactly under load.
 */
export async function requestNetworkPassword(
  who: { userId: string; tokenVersion: number },
  meta: { ip?: string; now?: Date } = {},
): Promise<PasswordAccessResult> {
  const now = meta.now ?? new Date();
  await connectDb();
  const session = await mongoose.startSession();
  try {
    let result: PasswordAccessResult | undefined;
    await session.withTransaction(async () => {
      result = await decide(who, meta.ip, now, session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

async function decide(
  who: { userId: string; tokenVersion: number },
  ip: string | undefined,
  now: Date,
  session: ClientSession,
): Promise<PasswordAccessResult> {
  // Re-checked here, not only at the start of the request, because a chat
  // turn can take several seconds and a revocation must win.
  const user = await User.findOneAndUpdate(
    { _id: who.userId },
    { $inc: { passwordRequestSeq: 1 } },
    { session, returnDocument: "after", projection: { status: 1, tokenVersion: 1 } },
  ).lean();
  if (!user || user.status !== "ACTIVE" || user.tokenVersion !== who.tokenVersion) {
    const reason = user?.status === "REVOKED" ? "REVOKED" : "NOT_AUTHORIZED";
    await logPasswordRequest(
      { userId: user ? who.userId : undefined, granted: false, denialReason: reason, ip },
      session,
    );
    return { ok: false, reason };
  }

  // Sliding window over this user's granted requests.
  const windowStart = new Date(now.getTime() - REVEAL_LIMIT.windowMs);
  const recent = await PasswordRequest.find({
    user: who.userId,
    granted: true,
    createdAt: { $gt: windowStart },
  })
    .session(session)
    .sort({ createdAt: 1 })
    .limit(REVEAL_LIMIT.max)
    .select("createdAt")
    .lean();
  if (recent.length >= REVEAL_LIMIT.max) {
    await logPasswordRequest(
      { userId: who.userId, granted: false, denialReason: "RATE_LIMITED", ip },
      session,
    );
    return {
      ok: false,
      reason: "RATE_LIMITED",
      retryAt: new Date(recent[0].createdAt.getTime() + REVEAL_LIMIT.windowMs),
    };
  }

  const current = await getCurrentNetworkPassword();
  if (!current) return { ok: false, reason: "NO_PASSWORD" };

  await logPasswordRequest({ userId: who.userId, granted: true, ip }, session);
  return { ok: true, password: current.password, rotatedAt: current.rotatedAt };
}
