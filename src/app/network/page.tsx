import type { Metadata } from "next";

import { UserHeader } from "@/components/user-header";

import { NetworkClient } from "./network-client";

export const metadata: Metadata = { title: "Network · PassCode" };

/**
 * Joining the virtual Wi-Fi. Open to everyone, like the assistant page: in real
 * life a device joins a network with the password, not with an identity, and
 * the point PassCode makes is that a password obtained informally stops working
 * at the next rotation.
 *
 * All data comes from /api/network so the route handler can set the per-browser
 * device cookie (a Server Component can't) and so the page can poll for the
 * moment a rotation drops the device.
 */
export default function NetworkPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <UserHeader active="network" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
        <NetworkClient />
      </main>
    </div>
  );
}
