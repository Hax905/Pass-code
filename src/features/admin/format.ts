import type { RotationSchedule } from "@/features/rotation/schedule";

/** 90 → "01:30" */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "01:30" → 90; null for anything that isn't HH:MM. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

const UNIT_NAMES = { HOURS: "hour", DAYS: "day", WEEKS: "week" } as const;

/** "Every 2 weeks, between 02:00 and 04:00 (America/Costa_Rica)" */
export function describeSchedule(schedule: RotationSchedule): string {
  const unit = UNIT_NAMES[schedule.intervalUnit];
  let text =
    schedule.intervalValue === 1 ? `Every ${unit}` : `Every ${schedule.intervalValue} ${unit}s`;
  const { windowStartMinute: start, windowEndMinute: end } = schedule;
  if (start != null && end != null && start !== end) {
    text += `, between ${minutesToTime(start)} and ${minutesToTime(end)}`;
  }
  return `${text} (${schedule.timezone})`;
}
