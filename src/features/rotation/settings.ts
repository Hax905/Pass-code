// Rotation settings and status for the admin app (PRD §6.2, Flow A).
import mongoose, { type Types } from "mongoose";
import { z } from "zod";

import type { AuthorizedUser } from "@/features/auth/types";
import { connectDb } from "@/lib/db/connection";
import {
  AuditLog,
  INTERVAL_UNITS,
  RotationEvent,
  RotationSettings,
  ROTATION_SETTINGS_ID,
  type ROTATION_STATUSES,
  type ROTATION_TRIGGERS,
} from "@/lib/db/models";

import { nextRotationDueAt, type RotationSchedule } from "./schedule";

const MAX_INTERVAL_HOURS = 366 * 24;
const UNIT_HOURS = { HOURS: 1, DAYS: 24, WEEKS: 24 * 7 } as const;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const rotationSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    intervalValue: z.int().min(1),
    intervalUnit: z.enum(INTERVAL_UNITS),
    windowStartMinute: z.int().min(0).max(1439).nullable(),
    windowEndMinute: z.int().min(0).max(1439).nullable(),
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  })
  .refine((s) => s.intervalValue * UNIT_HOURS[s.intervalUnit] <= MAX_INTERVAL_HOURS, {
    message: "Rotate at least once a year",
    path: ["intervalValue"],
  })
  .refine((s) => (s.windowStartMinute === null) === (s.windowEndMinute === null), {
    message: "Set both the start and the end of the window, or neither",
    path: ["windowEndMinute"],
  });

export type RotationSettingsInput = z.infer<typeof rotationSettingsInputSchema>;

export interface RotationSettingsView extends RotationSettingsInput {
  /** Pass back when saving, so concurrent edits are detected instead of overwritten. */
  version: number;
  updatedAt?: Date;
}

export class SettingsConflictError extends Error {
  constructor() {
    super("The settings were changed by someone else. Reload and try again.");
    this.name = "SettingsConflictError";
  }
}

export async function getRotationSettings(): Promise<RotationSettingsView | null> {
  await connectDb();
  const doc = await RotationSettings.findById(ROTATION_SETTINGS_ID).lean();
  if (!doc) return null;
  return {
    enabled: doc.enabled,
    intervalValue: doc.intervalValue,
    intervalUnit: doc.intervalUnit,
    windowStartMinute: doc.windowStartMinute ?? null,
    windowEndMinute: doc.windowEndMinute ?? null,
    timezone: doc.timezone,
    version: doc.__v ?? 0,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Creates or updates the settings. Saving them for the first time is what
 * starts scheduled rotation. `expectedVersion` is the version the admin
 * edited (null when there were no settings yet).
 */
export async function saveRotationSettings(
  actor: AuthorizedUser,
  input: RotationSettingsInput,
  expectedVersion: number | null,
): Promise<RotationSettingsView> {
  if (actor.role !== "ADMIN") throw new Error("Admin privileges required");
  const settings = rotationSettingsInputSchema.parse(input);
  await connectDb();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const doc = await RotationSettings.findById(ROTATION_SETTINGS_ID).session(session);
      if ((doc?.__v ?? null) !== expectedVersion) throw new SettingsConflictError();
      const before = doc?.toObject();

      const target = doc ?? new RotationSettings({ _id: ROTATION_SETTINGS_ID });
      target.set({
        ...settings,
        windowStartMinute: settings.windowStartMinute ?? undefined,
        windowEndMinute: settings.windowEndMinute ?? undefined,
        updatedBy: actor.id,
      });
      // Mongoose only bumps the version for array changes; bump it for every save.
      if (doc) target.increment();
      await target.save({ session });

      await AuditLog.create(
        [
          {
            actor: actor.id,
            action: "rotation.settings_updated",
            target: ROTATION_SETTINGS_ID,
            metadata: { before: before ? pickSettings(before) : null, after: settings },
          },
        ],
        { session },
      );
    });
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) throw new SettingsConflictError();
    throw error;
  } finally {
    await session.endSession();
  }
  return (await getRotationSettings())!;
}

function pickSettings(doc: Record<string, unknown>) {
  const { enabled, intervalValue, intervalUnit, windowStartMinute, windowEndMinute, timezone } =
    doc;
  return { enabled, intervalValue, intervalUnit, windowStartMinute, windowEndMinute, timezone };
}

export interface RotationEventView {
  id: string;
  trigger: (typeof ROTATION_TRIGGERS)[number];
  triggeredBy?: { id: string; email: string };
  status: (typeof ROTATION_STATUSES)[number];
  attempts: number;
  adapter: string;
  errorMessage?: string;
  manualApplicationRequired?: boolean;
  createdAt: Date;
  completedAt?: Date;
}

type PopulatedEvent = {
  _id: Types.ObjectId;
  trigger: RotationEventView["trigger"];
  triggeredBy?: { _id: Types.ObjectId; email: string } | null;
  status: RotationEventView["status"];
  attempts: number;
  adapter: string;
  errorMessage?: string | null;
  manualApplicationRequired?: boolean | null;
  createdAt: Date;
  completedAt?: Date | null;
};

function toEventView(e: PopulatedEvent): RotationEventView {
  return {
    id: e._id.toString(),
    trigger: e.trigger,
    ...(e.triggeredBy
      ? { triggeredBy: { id: e.triggeredBy._id.toString(), email: e.triggeredBy.email } }
      : {}),
    status: e.status,
    attempts: e.attempts,
    adapter: e.adapter,
    ...(e.errorMessage ? { errorMessage: e.errorMessage } : {}),
    ...(e.manualApplicationRequired != null
      ? { manualApplicationRequired: e.manualApplicationRequired }
      : {}),
    createdAt: e.createdAt,
    ...(e.completedAt ? { completedAt: e.completedAt } : {}),
  };
}

function findEvents(filter: Record<string, unknown> = {}) {
  return RotationEvent.find(filter)
    .sort({ createdAt: -1 })
    .populate("triggeredBy", "email")
    .lean<PopulatedEvent[]>();
}

/** Rotation history, newest first. Never includes the password. */
export async function listRotationEvents(limit = 50): Promise<RotationEventView[]> {
  await connectDb();
  const events = await findEvents().limit(Math.min(Math.max(limit, 1), 200));
  return events.map(toEventView);
}

export interface RotationStatus {
  configured: boolean;
  enabled: boolean;
  lastSuccess?: RotationEventView;
  lastEvent?: RotationEventView;
  inProgress: boolean;
  /** Earliest time the scheduler will rotate (the window may push it later). */
  nextDueAt?: Date | null;
}

export async function getRotationStatus(): Promise<RotationStatus> {
  await connectDb();
  const [settings, [lastEvent], [lastSuccess], inProgress] = await Promise.all([
    getRotationSettings(),
    findEvents().limit(1),
    findEvents({ status: "SUCCEEDED" }).limit(1),
    RotationEvent.exists({ status: "PENDING" }),
  ]);
  const schedule: RotationSchedule | null = settings;
  return {
    configured: settings !== null,
    enabled: settings?.enabled ?? false,
    ...(lastSuccess ? { lastSuccess: toEventView(lastSuccess) } : {}),
    ...(lastEvent ? { lastEvent: toEventView(lastEvent) } : {}),
    inProgress: inProgress !== null,
    nextDueAt:
      schedule && schedule.enabled
        ? (nextRotationDueAt(schedule, lastSuccess?.createdAt) ?? new Date())
        : undefined,
  };
}
