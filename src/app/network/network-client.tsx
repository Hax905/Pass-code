"use client";

import {
  LaptopIcon,
  PlugIcon,
  PlugZapIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** How often the page re-checks whether it is still on the network. */
const POLL_MS = 5000;

type Device = {
  id: string;
  deviceName: string;
  connectedAt: string;
  online: boolean;
  droppedByRotation: boolean;
};

type NetworkState = {
  networkReady: boolean;
  passwordChangedAt: string | null;
  devices: Device[];
};

export function NetworkClient() {
  const [state, setState] = useState<NetworkState | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/network/status", { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as NetworkState;
      setState(next);
      // Drop the "X is on the network" confirmation once it stops being true,
      // so a rotation doesn't leave it contradicting the disconnection notice.
      if (next.devices.some((device) => device.droppedByRotation)) setNotice(null);
    } catch {
      // A failed poll just means the next one shows it; don't shout at the user.
    }
  }, []);

  // Polling is what makes a rotation visible here: the device list is re-read
  // every few seconds, so a password change drops this device on screen
  // without anyone touching the page.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    // The first read is queued rather than run in the effect body, so this stays
    // a subscription to an external system instead of a render-time state write.
    const first = setTimeout(() => void load(), 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [load]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/network/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName, password }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(data?.message ?? "Couldn't connect. Please try again.");
      } else {
        setNotice(`${deviceName} is on the network.`);
        setPassword("");
        setDeviceName("");
      }
    } catch {
      setError("Couldn't reach the network. Please try again.");
    } finally {
      setPending(false);
      void load();
    }
  }

  async function disconnect(id: string) {
    await fetch("/api/network/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: id }),
    }).catch(() => null);
    void load();
  }

  const devices = state?.devices ?? [];
  const online = devices.filter((device) => device.online);
  const dropped = devices.filter((device) => device.droppedByRotation);

  return (
    <>
      {dropped.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {dropped.length === 1
              ? `${dropped[0].deviceName} was disconnected`
              : `${dropped.length} devices were disconnected`}
          </AlertTitle>
          <AlertDescription>
            <span>
              The network password changed
              {state?.passwordChangedAt && <> at {formatTime(state.passwordChangedAt)}</>}, so the
              password this device joined with no longer works. Ask the assistant for the current
              one and connect again.
            </span>
            <Button size="sm" nativeButton={false} render={<Link href="/chat" />}>
              Ask the assistant
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {online.length > 0 ? (
              <>
                <WifiIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
                On the network
              </>
            ) : (
              <>
                <WifiOffIcon className="size-5 text-muted-foreground" />
                Not connected
              </>
            )}
          </CardTitle>
          <CardDescription>
            {online.length > 0
              ? `${online.length} ${online.length === 1 ? "device" : "devices"} connected with the current password. A rotation disconnects ${online.length === 1 ? "it" : "them"}.`
              : "Enter the current network password to join the building's Wi-Fi."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={connect} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="deviceName">Device</Label>
              <Input
                id="deviceName"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="My phone"
                maxLength={40}
                required
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="networkPassword">Network password</Label>
              <Input
                id="networkPassword"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="The current password"
                required
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <RefreshCwIcon className="animate-spin" />
              ) : (
                <PlugZapIcon aria-hidden="true" />
              )}
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          {notice && !error && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
          {state && !state.networkReady && (
            <p className="mt-3 text-sm text-muted-foreground">
              There is no network password yet — an admin has to rotate once before anything can
              connect.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This browser&apos;s devices</CardTitle>
          <CardDescription>
            Checked every few seconds, so a rotation shows up here on its own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {state === null ? "Loading…" : "No devices have connected from this browser yet."}
            </p>
          ) : (
            <ul className="divide-y">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{device.deviceName}</span>
                  {device.online ? (
                    <Badge className="bg-emerald-600 text-white dark:bg-emerald-500">Online</Badge>
                  ) : device.droppedByRotation ? (
                    <Badge variant="destructive">Dropped by rotation</Badge>
                  ) : (
                    <Badge variant="secondary">Disconnected</Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    joined {formatTime(device.connectedAt)}
                  </span>
                  {device.online && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => void disconnect(device.id)}
                    >
                      <PlugIcon aria-hidden="true" />
                      Disconnect
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
