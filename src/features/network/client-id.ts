import "server-only";

import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

export const CLIENT_COOKIE = "passcode_device_client";

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * An opaque per-browser token identifying which devices a visitor may see and
 * disconnect. Not a credential: it carries no authority over anything but the
 * simulated devices it joined, which is why it exists at all — someone with no
 * account still needs a way to see their own device drop off at a rotation.
 *
 * Deliberately not `secure`, so the demo also works when a phone on the same
 * network opens it over plain http.
 *
 * Only callable from a Route Handler or Server Action: Server Components can't
 * set cookies, which is why the network page gets its data from /api/network.
 */
export async function getOrCreateClientId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CLIENT_COOKIE)?.value;
  if (existing && TOKEN_PATTERN.test(existing)) return existing;

  const token = randomBytes(16).toString("hex");
  store.set(CLIENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return token;
}
