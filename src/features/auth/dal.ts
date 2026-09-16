import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";

import { AccessDeniedError } from "./errors";
import { authorizeSession, type AccessLevel } from "./session-guard";
import type { AuthorizedUser } from "./types";

export { safeRedirectPath } from "@/lib/safe-redirect";

// Data access layer for pages and server actions (Next.js authentication guide).
// Layouts don't re-render on navigation, so every page and every action must
// call one of these itself.

const readSession = cache(auth);

async function check(
  level: AccessLevel,
  path?: string,
): Promise<AuthorizedUser | AccessDeniedError["code"]> {
  const session = await readSession();
  try {
    return await authorizeSession(
      session && { userId: session.user?.id, tokenVersion: session.user?.tokenVersion },
      level,
      { path },
    );
  } catch (error) {
    if (error instanceof AccessDeniedError) return error.code;
    throw error;
  }
}

/** The signed-in user after the full database check, or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<AuthorizedUser | null> => {
  const result = await check("user");
  return typeof result === "string" ? null : result;
});

/** For pages: sends visitors to the login page, and non-admins to the home page. */
export async function requirePageAccess(level: AccessLevel, path: string): Promise<AuthorizedUser> {
  const result = await check(level, path);
  if (result === "forbidden") redirect("/?denied=admin");
  if (typeof result === "string") redirect(`/login?next=${encodeURIComponent(path)}`);
  return result;
}

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** For server actions, which are public endpoints: returns an error message instead of redirecting. */
export async function requireActionAccess(
  level: AccessLevel,
  path: string,
): Promise<AuthorizedUser | { ok: false; error: string }> {
  const result = await check(level, path);
  if (result === "forbidden") return { ok: false, error: "Only admins can do this." };
  if (typeof result === "string") {
    return { ok: false, error: "Your session has ended. Sign in again." };
  }
  return result;
}
