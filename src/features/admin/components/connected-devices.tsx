import { LaptopIcon, UserXIcon, WifiIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listConnectedDevices } from "@/features/network/virtual-network";

import { LocalTime } from "./local-time";

/**
 * Who is on the virtual Wi-Fi right now. Rotating re-renders this page, so the
 * list empties on screen the moment the password changes — every device is
 * tied to the rotation it joined with, and none of them match any more.
 */
export async function ConnectedDevices() {
  const { online, droppedByLastRotation } = await listConnectedDevices();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiIcon className="size-5 text-muted-foreground" />
          On the network
          <Badge variant="secondary">{online.length}</Badge>
        </CardTitle>
        <CardDescription>
          Devices connected with the current password.{" "}
          {droppedByLastRotation > 0 && (
            <span>
              {droppedByLastRotation} {droppedByLastRotation === 1 ? "device was" : "devices were"}{" "}
              dropped by the latest rotation and{" "}
              {droppedByLastRotation === 1 ? "hasn't" : "haven't"} reconnected.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {online.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is connected right now.</p>
        ) : (
          <ul className="divide-y">
            {online.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{device.deviceName}</span>
                {device.email ? (
                  <span className="text-sm text-muted-foreground">{device.email}</span>
                ) : (
                  // Someone who got the password without holding an account:
                  // exactly the informal sharing this project exists to surface.
                  <Badge variant="destructive" className="gap-1">
                    <UserXIcon className="size-3" />
                    No account
                  </Badge>
                )}
                <span className="ml-auto text-sm text-muted-foreground">
                  <LocalTime date={device.connectedAt} relative />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
