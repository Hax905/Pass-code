/**
 * The virtual router's Wi-Fi side: devices join the network by entering the
 * current network password, and a rotation drops all of them.
 *
 * This models association only. The RouterAdapter boundary stays a single
 * applyPassword call, because a real router adapter must never grow
 * client-management powers (PRD §4) — so none of this lives behind it.
 *
 * The central idea: a connection row stores the rotation whose password the
 * device joined with, and the device is on the network only while that is still
 * the newest successful rotation. A rotation therefore disconnects everyone
 * without writing to a single row here — the rows don't change, the current
 * generation does. That keeps rotation's own transaction exactly as it was, and
 * means the network can never disagree with the password history.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import mongoose from "mongoose";
import { z } from "zod";

import { getCurrentNetworkPassword } from "@/features/rotation/rotation-service";
import { connectDb } from "@/lib/db/connection";
import { AuditLog, NetworkConnection, User } from "@/lib/db/models";

import { clientConnectLimiter, ipConnectLimiter } from "./rate-limit";

export const connectInputSchema = z.object({
  deviceName: z
    .string()
    .trim()
    .min(1, "Give the device a name")
    .max(40, "Device names are at most 40 characters"),
  password: z.string().min(1, "Enter the network password").max(200),
});

export type ConnectInput = z.infer<typeof connectInputSchema>;

export interface DeviceView {
  id: string;
  deviceName: string;
  connectedAt: Date;
  /** On the network right now: joined with the password that is still current. */
  online: boolean;
  /** Offline because the password changed under it, rather than by choice. */
  droppedByRotation: boolean;
}

export type ConnectResult =
  | { ok: true; device: DeviceView }
  | { ok: false; reason: "WRONG_PASSWORD" | "NO_PASSWORD" | "ALREADY_CONNECTED" }
  | { ok: false; reason: "RATE_LIMITED"; retryAt: Date };

export interface NetworkStateForClient {
  /** True once a rotation has produced a password to connect with. */
  networkReady: boolean;
  /** When the current password came into force; only sent to a caller that has connected before. */
  passwordChangedAt: Date | null;
  devices: DeviceView[];
}

/**
 * Joins `deviceName` to the virtual Wi-Fi if `password` is the current network
 * password. Every attempt that isn't rate-limited is written to the audit log,
 * so an admin can see devices joining — including ones with no account, which
 * is the informal sharing this project exists to make visible.
 */
export async function connectDevice(
  input: ConnectInput & { client: string; userId?: string; ip?: string },
  meta: { now?: Date } = {},
): Promise<ConnectResult> {
  const now = (meta.now ?? new Date()).getTime();

  // Rate limited before anything is read, so a refused attempt learns nothing
  // at all — not even whether a password exists yet.
  for (const [limiter, key] of [
    [clientConnectLimiter, input.client],
    [ipConnectLimiter, input.ip ?? "unknown"],
  ] as const) {
    const allowed = limiter.hit(key, now);
    if (!allowed.allowed) return { ok: false, reason: "RATE_LIMITED", retryAt: allowed.retryAt };
  }

  await connectDb();
  const current = await getCurrentNetworkPassword();
  if (!current) return { ok: false, reason: "NO_PASSWORD" };

  if (!samePassword(input.password, current.password)) {
    await AuditLog.create({
      actor: input.userId,
      action: "network.connect_denied",
      target: current.eventId,
      metadata: { deviceName: input.deviceName, reason: "WRONG_PASSWORD", sourceIp: input.ip },
    });
    return { ok: false, reason: "WRONG_PASSWORD" };
  }

  const session = await mongoose.startSession();
  try {
    let result: ConnectResult | undefined;
    await session.withTransaction(async () => {
      // Rows this browser left behind on older passwords are closed out first,
      // so reconnecting the same device reads as one device over time rather
      // than a pile of stale rows, and the unique index has room for the new one.
      await NetworkConnection.updateMany(
        {
          client: input.client,
          deviceName: input.deviceName,
          status: "CONNECTED",
          rotationEvent: { $ne: current.eventId },
        },
        {
          status: "DISCONNECTED",
          disconnectedAt: new Date(now),
          disconnectReason: "PASSWORD_CHANGED",
        },
        { session },
      );

      const [connection] = await NetworkConnection.create(
        [
          {
            deviceName: input.deviceName,
            user: input.userId,
            client: input.client,
            rotationEvent: current.eventId,
            sourceIp: input.ip,
          },
        ],
        { session },
      );
      await AuditLog.create(
        [
          {
            actor: input.userId,
            action: "network.connected",
            target: connection._id.toString(),
            metadata: {
              deviceName: input.deviceName,
              rotationEvent: current.eventId,
              sourceIp: input.ip,
              withAccount: Boolean(input.userId),
            },
          },
        ],
        { session },
      );
      result = { ok: true, device: toDeviceView(connection, current.eventId) };
    });
    return result!;
  } catch (error) {
    // The unique index caught a device this browser already has on the network.
    if (isDuplicateKeyError(error)) return { ok: false, reason: "ALREADY_CONNECTED" };
    throw error;
  } finally {
    await session.endSession();
  }
}

/** Leaves the network by choice. Only the browser that joined can disconnect its own row. */
export async function disconnectDevice(input: {
  client: string;
  connectionId: string;
  userId?: string;
}): Promise<{ ok: boolean }> {
  await connectDb();
  if (!mongoose.isValidObjectId(input.connectionId)) return { ok: false };

  const updated = await NetworkConnection.findOneAndUpdate(
    { _id: input.connectionId, client: input.client, status: "CONNECTED" },
    { status: "DISCONNECTED", disconnectedAt: new Date(), disconnectReason: "BY_USER" },
    { returnDocument: "after" },
  ).lean();
  if (!updated) return { ok: false };

  await AuditLog.create({
    actor: input.userId,
    action: "network.disconnected",
    target: input.connectionId,
    metadata: { deviceName: updated.deviceName, reason: "BY_USER" },
  });
  return { ok: true };
}

/** What one browser sees on the network page: its own devices and whether each is still on. */
export async function getNetworkStateForClient(client: string): Promise<NetworkStateForClient> {
  await connectDb();
  const current = await getCurrentNetworkPassword();
  const devices = await NetworkConnection.find({ client })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("deviceName status createdAt rotationEvent")
    .lean();

  return {
    networkReady: current !== null,
    // Withheld from a browser that has never held the password: when it last
    // changed is only meaningful — and only disclosed — to a device that joined.
    passwordChangedAt: devices.length > 0 ? (current?.rotatedAt ?? null) : null,
    devices: devices.map((device) => toDeviceView(device, current?.eventId)),
  };
}

export interface ConnectedDevicesView {
  online: {
    id: string;
    deviceName: string;
    connectedAt: Date;
    email: string | null;
  }[];
  /** Devices the newest rotation knocked off and that haven't come back. */
  droppedByLastRotation: number;
}

/** The admin dashboard's live view of the virtual network. */
export async function listConnectedDevices(): Promise<ConnectedDevicesView> {
  await connectDb();
  const current = await getCurrentNetworkPassword();
  if (!current) return { online: [], droppedByLastRotation: 0 };

  const [online, droppedByLastRotation] = await Promise.all([
    NetworkConnection.find({ status: "CONNECTED", rotationEvent: current.eventId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("deviceName createdAt user")
      .populate<{ user: { email: string } | null }>({ path: "user", select: "email", model: User })
      .lean(),
    NetworkConnection.countDocuments({
      status: "CONNECTED",
      rotationEvent: { $ne: current.eventId },
    }),
  ]);

  return {
    online: online.map((device) => ({
      id: device._id.toString(),
      deviceName: device.deviceName,
      connectedAt: device.createdAt,
      email: device.user?.email ?? null,
    })),
    droppedByLastRotation,
  };
}

function toDeviceView(
  device: {
    _id: mongoose.Types.ObjectId;
    deviceName: string;
    status: string;
    createdAt: Date;
    rotationEvent: mongoose.Types.ObjectId;
  },
  currentEventId: string | undefined,
): DeviceView {
  const current =
    currentEventId !== undefined && device.rotationEvent.toString() === currentEventId;
  return {
    id: device._id.toString(),
    deviceName: device.deviceName,
    connectedAt: device.createdAt,
    online: device.status === "CONNECTED" && current,
    droppedByRotation: device.status === "CONNECTED" && !current,
  };
}

/** Compares hashes so the check is constant-time whatever the lengths are. */
export function samePassword(candidate: string, actual: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(actual));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}
