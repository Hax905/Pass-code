import { describe, expect, it } from "vitest";

import {
  FAILED_ROTATION_RETRY_MS,
  evaluateSchedule,
  isWithinWindow,
  minuteOfDay,
  nextRotationDueAt,
  type RotationSchedule,
} from "./schedule";

const HOUR = 60 * 60 * 1000;
const base: RotationSchedule = {
  enabled: true,
  intervalValue: 1,
  intervalUnit: "DAYS",
  timezone: "UTC",
};
const at = (iso: string) => new Date(iso);

describe("minuteOfDay", () => {
  it("converts to the configured time zone", () => {
    const date = at("2026-09-16T03:30:00Z");
    expect(minuteOfDay(date, "UTC")).toBe(3 * 60 + 30);
    // Costa Rica is UTC-6 with no DST.
    expect(minuteOfDay(date, "America/Costa_Rica")).toBe(21 * 60 + 30);
  });
});

describe("isWithinWindow", () => {
  it("allows any time when no window is set", () => {
    expect(isWithinWindow(base, at("2026-09-16T12:00:00Z"))).toBe(true);
    expect(isWithinWindow({ ...base, windowStartMinute: 60 }, at("2026-09-16T12:00:00Z"))).toBe(
      true,
    );
  });

  it("handles a same-day window with an exclusive end", () => {
    const schedule = { ...base, windowStartMinute: 2 * 60, windowEndMinute: 4 * 60 };
    expect(isWithinWindow(schedule, at("2026-09-16T01:59:00Z"))).toBe(false);
    expect(isWithinWindow(schedule, at("2026-09-16T02:00:00Z"))).toBe(true);
    expect(isWithinWindow(schedule, at("2026-09-16T03:59:00Z"))).toBe(true);
    expect(isWithinWindow(schedule, at("2026-09-16T04:00:00Z"))).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const schedule = { ...base, windowStartMinute: 22 * 60, windowEndMinute: 6 * 60 };
    expect(isWithinWindow(schedule, at("2026-09-16T23:00:00Z"))).toBe(true);
    expect(isWithinWindow(schedule, at("2026-09-16T05:00:00Z"))).toBe(true);
    expect(isWithinWindow(schedule, at("2026-09-16T12:00:00Z"))).toBe(false);
  });

  it("applies the window in local time", () => {
    // 01:00–03:00 in Costa Rica = 07:00–09:00 UTC.
    const schedule = {
      ...base,
      timezone: "America/Costa_Rica",
      windowStartMinute: 60,
      windowEndMinute: 180,
    };
    expect(isWithinWindow(schedule, at("2026-09-16T08:00:00Z"))).toBe(true);
    expect(isWithinWindow(schedule, at("2026-09-16T02:00:00Z"))).toBe(false);
  });
});

describe("evaluateSchedule", () => {
  const now = at("2026-09-16T12:00:00Z");

  it("rotates immediately when there has never been a successful rotation", () => {
    expect(evaluateSchedule({ schedule: base, now })).toEqual({ due: true });
  });

  it("does nothing when disabled", () => {
    expect(evaluateSchedule({ schedule: { ...base, enabled: false }, now })).toEqual({
      due: false,
      reason: "disabled",
    });
  });

  it("waits for the interval to pass", () => {
    const schedule = { ...base, intervalValue: 2, intervalUnit: "WEEKS" as const };
    const lastSuccessAt = new Date(now.getTime() - 13 * 24 * HOUR);
    expect(evaluateSchedule({ schedule, now, lastSuccessAt })).toEqual({
      due: false,
      reason: "not-yet-due",
    });
    expect(nextRotationDueAt(schedule, lastSuccessAt)).toEqual(new Date(now.getTime() + 24 * HOUR));
    expect(
      evaluateSchedule({ schedule, now: new Date(now.getTime() + 24 * HOUR), lastSuccessAt }),
    ).toEqual({ due: true });
  });

  it("backs off after a failure, then retries", () => {
    const lastSuccessAt = new Date(now.getTime() - 48 * HOUR);
    const lastFailureAt = new Date(now.getTime() - 60_000);
    expect(evaluateSchedule({ schedule: base, now, lastSuccessAt, lastFailureAt })).toEqual({
      due: false,
      reason: "retry-backoff",
    });
    const later = new Date(lastFailureAt.getTime() + FAILED_ROTATION_RETRY_MS);
    expect(evaluateSchedule({ schedule: base, now: later, lastSuccessAt, lastFailureAt })).toEqual({
      due: true,
    });
  });

  it("ignores failures older than the last success", () => {
    const lastFailureAt = new Date(now.getTime() - 25 * HOUR);
    const lastSuccessAt = new Date(now.getTime() - 24 * HOUR);
    expect(evaluateSchedule({ schedule: base, now, lastSuccessAt, lastFailureAt })).toEqual({
      due: true,
    });
  });

  it("waits for the rotation window", () => {
    const schedule = { ...base, windowStartMinute: 2 * 60, windowEndMinute: 4 * 60 };
    expect(evaluateSchedule({ schedule, now })).toEqual({ due: false, reason: "outside-window" });
  });
});
