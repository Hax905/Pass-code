// Credentials check used by the Auth.js credentials provider (src/auth.ts).
// Every attempt is audited; the password itself is never logged.
import type { Types } from "mongoose";
import { z } from "zod";

import { connectDb } from "@/lib/db/connection";
import { AuditLog, User } from "@/lib/db/models";

import { verifyAgainstDummy, verifyPassword } from "./password";
import type { AuthorizedUser, Role, UserStatus } from "./types";

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});

export type LoginResult =
  | { ok: true; user: AuthorizedUser }
  | {
      ok: false;
      reason: "invalid_input" | "invalid_credentials" | "too_many_attempts" | "pending" | "revoked";
    };

export async function authenticateCredentials(
  credentials: Partial<Record<string, unknown>>,
  meta: { ip?: string } = {},
): Promise<LoginResult> {
  const parsed = credentialsSchema.safeParse({
    email: typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "",
    password: credentials.password,
  });
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { email, password } = parsed.data;

  await connectDb();

  // Throttle per email. Checked before the password so a locked account can't
  // be probed. Tradeoff: someone can lock a known email out for 15 minutes.
  const recentFailures = await AuditLog.countDocuments({
    action: "auth.login.failed",
    target: email,
    createdAt: { $gte: new Date(Date.now() - LOGIN_LOCKOUT_MS) },
  });
  if (recentFailures >= LOGIN_FAILURE_LIMIT) {
    return fail(email, "too_many_attempts", meta);
  }

  const user = await User.findOne({ email }).select("+passwordHash").lean<{
    _id: Types.ObjectId;
    email: string;
    name?: string | null;
    role: Role;
    status: UserStatus;
    tokenVersion: number;
    passwordHash?: string | null;
  }>();

  const passwordOk = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyAgainstDummy(password);
  if (!user || !passwordOk) return fail(email, "invalid_credentials", meta, user?._id.toString());

  // Status is only revealed to someone who knows the password.
  if (user.status === "PENDING") return fail(email, "pending", meta, user._id.toString());
  if (user.status === "REVOKED") return fail(email, "revoked", meta, user._id.toString());

  await AuditLog.create({
    actor: user._id,
    action: "auth.login.succeeded",
    target: email,
    metadata: { ip: meta.ip },
  });
  return {
    ok: true,
    user: {
      id: user._id.toString(),
      email: user.email,
      ...(user.name ? { name: user.name } : {}),
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
  };
}

async function fail(
  email: string,
  reason: Exclude<LoginResult, { ok: true }>["reason"],
  meta: { ip?: string },
  userId?: string,
): Promise<LoginResult> {
  await AuditLog.create({
    actor: userId,
    action: "auth.login.failed",
    target: email,
    metadata: { reason, ip: meta.ip },
  });
  return { ok: false, reason };
}
