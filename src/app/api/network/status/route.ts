import { getOrCreateClientId } from "@/features/network/client-id";
import { getNetworkStateForClient } from "@/features/network/virtual-network";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET → this browser's devices and whether each is still on the network.
 * Polled by the network page, so a rotation shows up as devices dropping off
 * within a few seconds without anyone reloading.
 */
export async function GET() {
  const client = await getOrCreateClientId();
  const state = await getNetworkStateForClient(client);
  return Response.json(state, { headers: NO_STORE });
}
