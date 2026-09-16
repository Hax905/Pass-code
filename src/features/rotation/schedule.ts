// Pure scheduling rules (no database or timers), so they're unit-testable.
// The scheduler (scheduler.ts) ticks every minute and asks evaluateSchedule
// whether a rotation is due, instead of translating intervals into cron
// expressions (cron can't express "every 3 weeks").
import type { INTERVAL_UNITS } from "@/lib/db/models";

export interface RotationSchedule {
  enabled: boolean;
  intervalValue: number;
  intervalUnit: (typeof INTERVAL_UNITS)[number];
  /** Minutes after midnight in `timezone`. Both must be set for a window to apply. */
  windowStartMinute?: number | null;
  windowEndMinute?: number | null;
  timezone: string;
}

/** Wait this long after a failed rotation before the scheduler tries again. */
export const FAILED_ROTATION_RETRY_MS = 30 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const UNIT_MS = { HOURS: HOUR_MS, DAYS: 24 * HOUR_MS, WEEKS: 7 * 24 * HOUR_MS } as const;

export function intervalMs(schedule: Pick<RotationSchedule, "intervalValue" | "intervalUnit">) {
  return schedule.intervalValue * UNIT_MS[schedule.intervalUnit];
}

export function minuteOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: "hour" | "minute") => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

/**
 * The window is [start, end) in local time and may wrap past midnight
 * (e.g. 22:00–06:00). start === end means the whole day.
 */
export function isWithinWindow(schedule: RotationSchedule, now: Date): boolean {
  const { windowStartMinute: start, windowEndMinute: end } = schedule;
  if (start == null || end == null || start === end) return true;
  const minute = minuteOfDay(now, schedule.timezone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** When the next rotation becomes due, ignoring the window; null means due now. */
export function nextRotationDueAt(
  schedule: RotationSchedule,
  lastSuccessAt?: Date | null,
): Date | null {
  return lastSuccessAt ? new Date(lastSuccessAt.getTime() + intervalMs(schedule)) : null;
}

export type ScheduleDecision =
  | { due: true }
  | { due: false; reason: "disabled" | "not-yet-due" | "retry-backoff" | "outside-window" };

export function evaluateSchedule(input: {
  schedule: RotationSchedule;
  now: Date;
  lastSuccessAt?: Date | null;
  lastFailureAt?: Date | null;
}): ScheduleDecision {
  const { schedule, now, lastSuccessAt, lastFailureAt } = input;
  if (!schedule.enabled) return { due: false, reason: "disabled" };

  const dueAt = nextRotationDueAt(schedule, lastSuccessAt);
  if (dueAt && now < dueAt) return { due: false, reason: "not-yet-due" };

  if (
    lastFailureAt &&
    (!lastSuccessAt || lastFailureAt > lastSuccessAt) &&
    now.getTime() - lastFailureAt.getTime() < FAILED_ROTATION_RETRY_MS
  ) {
    return { due: false, reason: "retry-backoff" };
  }

  if (!isWithinWindow(schedule, now)) return { due: false, reason: "outside-window" };
  return { due: true };
}
