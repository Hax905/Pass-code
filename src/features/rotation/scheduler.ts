// Scheduled rotation (PRD §7 Flow B). A node-cron task ticks every minute and
// rotates when rotation_settings says a rotation is due. Safe to run in more
// than one process: the one_pending_rotation index lets only one rotation run.
import cron, { type ScheduledTask } from "node-cron";

import { connectDb } from "@/lib/db/connection";
import { RotationEvent, RotationSettings, ROTATION_SETTINGS_ID } from "@/lib/db/models";

import {
  RotationInProgressError,
  rotateNetworkPassword,
  type RotateOptions,
  type RotationResult,
} from "./rotation-service";
import { evaluateSchedule, type ScheduleDecision } from "./schedule";

export const SCHEDULER_CRON = "* * * * *";

export type SchedulerCheckResult =
  | Exclude<ScheduleDecision, { due: true }>
  | { due: false; reason: "not-configured" | "in-progress" }
  | { due: true; result: RotationResult };

type RotationOverrides = Omit<RotateOptions, "trigger" | "triggeredBy" | "source">;

/**
 * One scheduler tick. Does nothing until an admin has saved rotation settings,
 * so a fresh deployment never rotates on defaults nobody chose.
 */
export async function runScheduledRotationCheck(
  now = new Date(),
  overrides: RotationOverrides = {},
): Promise<SchedulerCheckResult> {
  await connectDb();
  const settings = await RotationSettings.findById(ROTATION_SETTINGS_ID).lean();
  if (!settings) return { due: false, reason: "not-configured" };

  const [lastSuccess, lastFailure] = await Promise.all(
    (["SUCCEEDED", "FAILED"] as const).map((status) =>
      RotationEvent.findOne({ status }).sort({ createdAt: -1 }).select("createdAt").lean(),
    ),
  );

  const decision = evaluateSchedule({
    schedule: settings,
    now,
    lastSuccessAt: lastSuccess?.createdAt,
    lastFailureAt: lastFailure?.createdAt,
  });
  if (!decision.due) return decision;

  try {
    const result = await rotateNetworkPassword({
      ...overrides,
      trigger: "SCHEDULED",
      source: "scheduler",
    });
    return { due: true, result };
  } catch (error) {
    if (error instanceof RotationInProgressError) return { due: false, reason: "in-progress" };
    throw error;
  }
}

type Logger = Pick<Console, "info" | "error">;

export function startRotationScheduler({ logger = console as Logger } = {}): ScheduledTask {
  return cron.schedule(
    SCHEDULER_CRON,
    async () => {
      try {
        const outcome = await runScheduledRotationCheck();
        if (!outcome.due) return;
        const { result } = outcome;
        if (result.status === "SUCCEEDED") {
          logger.info(
            `[rotation] Scheduled rotation ${result.eventId} succeeded` +
              (result.manualApplicationRequired ? " (apply the new password on the router)" : ""),
          );
        } else {
          logger.error(
            `[rotation] Scheduled rotation ${result.eventId} FAILED after ${result.attempts} attempts: ${result.errorMessage}`,
          );
        }
      } catch (error) {
        logger.error("[rotation] Scheduler check failed:", error);
      }
    },
    { name: "netguard-rotation", noOverlap: true },
  );
}
