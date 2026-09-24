import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { isSameOrigin, jsonError } from "@/features/auth/route-guard";
import { getOrCreateClientId } from "@/features/network/client-id";
import { disconnectDevice } from "@/features/network/virtual-network";

const bodySchema = z.object({ connectionId: z.string().min(1).max(64) });

/** POST { connectionId } → leaves the network. Only this browser's own devices. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return jsonError(403, "cross_origin_request");

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input", "Unknown device");

  const [client, session] = await Promise.all([getOrCreateClientId(), auth()]);
  const result = await disconnectDevice({
    client,
    connectionId: parsed.data.connectionId,
    userId: session?.user?.id,
  });
  if (!result.ok) return jsonError(404, "not_found", "That device isn't on the network.");

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
