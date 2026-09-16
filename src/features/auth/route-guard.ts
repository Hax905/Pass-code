import "server-only";

import type { NextRequest } from "next/server";

import { auth } from "@/auth";

import { AccessDeniedError, UserActionError } from "./errors";
import { authorizeSession, type AccessLevel } from "./session-guard";
import type { AuthorizedUser } from "./types";

type Handler<Ctx> = (request: NextRequest, context: Ctx, user: AuthorizedUser) => Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const USER_ACTION_STATUS: Record<UserActionError["code"], number> = {
  invalid_input: 400,
  user_not_found: 404,
  email_taken: 409,
  invalid_status: 409,
  cannot_modify_self: 409,
  last_admin: 409,
};

/**
 * Wraps a route handler so it only runs for an ACTIVE user with a current
 * session (and the ADMIN role for "admin"). Public routes simply don't use it.
 */
export function withAuth<Ctx>(level: AccessLevel, handler: Handler<Ctx>) {
  return async (request: NextRequest, context: Ctx): Promise<Response> => {
    // Session cookies are SameSite=Lax; also refuse cross-site state changes outright.
    if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
      return jsonError(403, "cross_origin_request");
    }

    let user: AuthorizedUser;
    try {
      const session = await auth();
      user = await authorizeSession(
        session && { userId: session.user?.id, tokenVersion: session.user?.tokenVersion },
        level,
        { path: request.nextUrl.pathname },
      );
    } catch (error) {
      if (error instanceof AccessDeniedError) return jsonError(error.status, error.code);
      throw error;
    }

    try {
      return await handler(request, context, user);
    } catch (error) {
      if (error instanceof UserActionError) {
        return jsonError(USER_ACTION_STATUS[error.code], error.code, error.message);
      }
      throw error;
    }
  };
}

export function jsonError(status: number, error: string, message?: string) {
  return Response.json({ error, ...(message ? { message } : {}) }, { status });
}

export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Browsers always send Origin on cross-site POSTs, so a missing header isn't a cross-site form.
  if (origin === null) return true;
  const allowed = [request.nextUrl.origin];
  // Behind a reverse proxy the public origin is the configured AUTH_URL.
  if (process.env.AUTH_URL) allowed.push(new URL(process.env.AUTH_URL).origin);
  return allowed.includes(origin);
}
