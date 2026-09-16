// The per-request authorization check (STYLES.md §2.4). A JWT stays valid until
// it expires, so every protected request re-reads the user and rejects the
// session unless the user is ACTIVE and the token's version is still current.
import { isValidObjectId } from "mongoose";

import { connectDb } from "@/lib/db/connection";
import { AuditLog, User } from "@/lib/db/models";

import { AccessDeniedError } from "./errors";
import type { AuthorizedUser, Role, UserStatus } from "./types";

export type AccessLevel = "user" | "admin";

export interface SessionClaims {
  userId?: string | null;
  tokenVersion?: number | null;
}

export async function authorizeSession(
  claims: SessionClaims | null | undefined,
  level: AccessLevel,
  meta: { path?: string } = {},
): Promise<AuthorizedUser> {
  const userId = claims?.userId;
  if (!userId) throw new AccessDeniedError(401, "unauthenticated");
  if (!isValidObjectId(userId) || typeof claims.tokenVersion !== "number") {
    throw new AccessDeniedError(401, "session_invalid");
  }

  await connectDb();
  const user = await User.findById(userId).lean<{
    _id: { toString(): string };
    email: string;
    name?: string | null;
    role: Role;
    status: UserStatus;
    tokenVersion: number;
  }>();

  if (!user || user.status !== "ACTIVE" || user.tokenVersion !== claims.tokenVersion) {
    await audit(userId, "session_invalid", level, meta.path, user?.status);
    throw new AccessDeniedError(401, "session_invalid");
  }
  if (level === "admin" && user.role !== "ADMIN") {
    await audit(userId, "forbidden", level, meta.path);
    throw new AccessDeniedError(403, "forbidden");
  }

  return {
    id: user._id.toString(),
    email: user.email,
    ...(user.name ? { name: user.name } : {}),
    role: user.role,
    tokenVersion: user.tokenVersion,
  };
}

function audit(
  userId: string,
  reason: string,
  level: AccessLevel,
  path: string | undefined,
  status?: UserStatus,
) {
  return AuditLog.create({
    actor: userId,
    action: "auth.access_denied",
    target: path,
    metadata: { reason, required: level, ...(status ? { status } : {}) },
  });
}
