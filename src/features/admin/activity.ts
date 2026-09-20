// Read models for the admin app: password request log and anomaly indicators
// (PRD §6.2). Simple thresholds for v1; Phase 5 adds alerting on top.
import type { Types } from "mongoose";

import { connectDb } from "@/lib/db/connection";
import {
  AuditLog,
  PasswordRequest,
  RotationEvent,
  User,
  type DENIAL_REASONS,
} from "@/lib/db/models";

const HOUR_MS = 60 * 60 * 1000;

export const ANOMALY_THRESHOLDS = {
  /** Granted password requests by one user in 24 h: may be relaying the password. */
  userRequestsPerDay: 5,
  /** Denied password requests (all users) in 1 h. */
  deniedRequestsPerHour: 10,
  /** Failed logins (all emails) in 1 h: possible password guessing. */
  failedLoginsPerHour: 20,
} as const;

export interface PasswordRequestView {
  id: string;
  user?: { id: string; email: string };
  granted: boolean;
  denialReason?: (typeof DENIAL_REASONS)[number];
  sourceIp?: string;
  createdAt: Date;
}

export async function listPasswordRequests(
  filter: { granted?: boolean } = {},
  limit = 100,
): Promise<PasswordRequestView[]> {
  await connectDb();
  const requests = await PasswordRequest.find(
    filter.granted === undefined ? {} : { granted: filter.granted },
  )
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .populate("user", "email")
    .lean<
      {
        _id: Types.ObjectId;
        user?: { _id: Types.ObjectId; email: string } | null;
        granted: boolean;
        denialReason?: PasswordRequestView["denialReason"] | null;
        sourceIp?: string | null;
        createdAt: Date;
      }[]
    >();
  return requests.map((r) => ({
    id: r._id.toString(),
    ...(r.user ? { user: { id: r.user._id.toString(), email: r.user.email } } : {}),
    granted: r.granted,
    ...(r.denialReason ? { denialReason: r.denialReason } : {}),
    ...(r.sourceIp ? { sourceIp: r.sourceIp } : {}),
    createdAt: r.createdAt,
  }));
}

export interface Anomaly {
  level: "warning" | "info";
  title: string;
  detail: string;
  href?: string;
}

export async function getAnomalies(now = new Date()): Promise<Anomaly[]> {
  await connectDb();
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);

  const [heavyUsers, deniedLastHour, failedLogins, lastRotation, pendingUsers, limitedUsers] =
    await Promise.all([
      PasswordRequest.aggregate<{ _id: Types.ObjectId; count: number; email?: string }>([
        { $match: { granted: true, createdAt: { $gte: dayAgo }, user: { $exists: true } } },
        { $group: { _id: "$user", count: { $sum: 1 } } },
        { $match: { count: { $gt: ANOMALY_THRESHOLDS.userRequestsPerDay } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
        { $project: { count: 1, email: { $first: "$u.email" } } },
      ]),
      PasswordRequest.countDocuments({ granted: false, createdAt: { $gte: hourAgo } }),
      AuditLog.countDocuments({ action: "auth.login.failed", createdAt: { $gte: hourAgo } }),
      RotationEvent.findOne({ status: { $ne: "PENDING" } })
        .sort({ createdAt: -1 })
        .select("status errorMessage createdAt")
        .lean(),
      User.countDocuments({ status: "PENDING" }),
      PasswordRequest.aggregate<{ _id: Types.ObjectId; count: number; email?: string }>([
        { $match: { denialReason: "RATE_LIMITED", createdAt: { $gte: dayAgo } } },
        { $group: { _id: "$user", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
        { $project: { count: 1, email: { $first: "$u.email" } } },
      ]),
    ]);

  const anomalies: Anomaly[] = [];

  if (lastRotation?.status === "FAILED") {
    anomalies.push({
      level: "warning",
      title: "The last password rotation failed",
      detail: lastRotation.errorMessage ?? "No error message was recorded.",
      href: "/admin/rotation",
    });
  }
  for (const user of heavyUsers) {
    anomalies.push({
      level: "warning",
      title: "Unusually many password requests",
      detail: `${user.email ?? "A deleted user"} requested the password ${user.count} times in the last 24 hours. They may be sharing it.`,
      href: "/admin/requests",
    });
  }
  for (const user of limitedUsers) {
    anomalies.push({
      level: "warning",
      title: "Password limit reached",
      detail: `${user.email ?? "A deleted user"} hit the hourly password limit ${user.count} time${user.count === 1 ? "" : "s"} in the last 24 hours.`,
      href: "/admin/requests?show=denied",
    });
  }
  if (deniedLastHour >= ANOMALY_THRESHOLDS.deniedRequestsPerHour) {
    anomalies.push({
      level: "warning",
      title: "Many denied password requests",
      detail: `${deniedLastHour} password requests were denied in the last hour.`,
      href: "/admin/requests",
    });
  }
  if (failedLogins >= ANOMALY_THRESHOLDS.failedLoginsPerHour) {
    anomalies.push({
      level: "warning",
      title: "Many failed sign-ins",
      detail: `${failedLogins} sign-in attempts failed in the last hour. Someone may be guessing passwords.`,
    });
  }
  if (pendingUsers > 0) {
    anomalies.push({
      level: "info",
      title: `${pendingUsers} account${pendingUsers === 1 ? "" : "s"} waiting for approval`,
      detail: "Approve or revoke them on the Users page.",
      href: "/admin/users?status=PENDING",
    });
  }
  return anomalies;
}
