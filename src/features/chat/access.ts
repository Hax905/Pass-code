// Deterministic gate in front of the chatbot (STYLES.md §2.6): decided before
// any prompt is built. People who aren't allowed in get a fixed answer, and
// their attempt is logged as a denied password request (PRD Flow D).
import { isValidObjectId } from "mongoose";

import type { AuthorizedUser, Role, UserStatus } from "@/features/auth/types";
import { connectDb } from "@/lib/db/connection";
import { User } from "@/lib/db/models";

import { logPasswordRequest } from "./password-access";
import { anonymousLimiter } from "./rate-limit";

export type ChatAccess =
  | { allowed: true; user: AuthorizedUser }
  | { allowed: false; reason: "UNAUTHENTICATED" | "REVOKED"; reply: string };

export function denialReply(reason: "UNAUTHENTICATED" | "REVOKED", supportContact?: string) {
  const contact = supportContact ?? "the building administrator";
  return reason === "REVOKED"
    ? `Your access to the building Wi-Fi has been revoked, so I can't give you the password. If you think this is a mistake, contact ${contact}.`
    : `I can only give the Wi-Fi password to people signed in with an approved account. Sign in, or request access and wait for an administrator to approve it. For help, contact ${contact}.`;
}

export async function resolveChatAccess(
  session: { userId?: string | null; tokenVersion?: number | null } | null,
  meta: { ip?: string; supportContact?: string },
): Promise<ChatAccess> {
  let user: {
    _id: { toString(): string };
    email: string;
    name?: string | null;
    role: Role;
    status: UserStatus;
    tokenVersion: number;
  } | null = null;
  if (session?.userId && isValidObjectId(session.userId)) {
    await connectDb();
    user = await User.findById(session.userId).lean();
  }

  if (user && user.status === "ACTIVE" && user.tokenVersion === session?.tokenVersion) {
    return {
      allowed: true,
      user: {
        id: user._id.toString(),
        email: user.email,
        ...(user.name ? { name: user.name } : {}),
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
    };
  }

  const reason = user?.status === "REVOKED" ? "REVOKED" : "UNAUTHENTICATED";
  // Log the attempt, but not without limit for people we can't identify.
  const limiterKey = user ? `user:${user._id.toString()}` : `ip:${meta.ip ?? "unknown"}`;
  if (anonymousLimiter.hit(limiterKey).allowed) {
    await logPasswordRequest({
      userId: user?._id.toString(),
      granted: false,
      denialReason: reason,
      ip: meta.ip,
    });
  }
  return { allowed: false, reason, reply: denialReply(reason, meta.supportContact) };
}
