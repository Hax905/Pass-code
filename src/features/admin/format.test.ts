import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/safe-redirect";

import { describeSchedule, minutesToTime, timeToMinutes } from "./format";

describe("time helpers", () => {
  it("converts between minutes and HH:MM", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(90)).toBe("01:30");
    expect(minutesToTime(1439)).toBe("23:59");
    expect(timeToMinutes("01:30")).toBe(90);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("rejects invalid times", () => {
    for (const value of ["24:00", "12:60", "1:30", "", "ab:cd"]) {
      expect(timeToMinutes(value)).toBeNull();
    }
  });
});

describe("describeSchedule", () => {
  const base = { enabled: true, timezone: "UTC" } as const;

  it("describes intervals and windows", () => {
    expect(describeSchedule({ ...base, intervalValue: 1, intervalUnit: "DAYS" })).toBe(
      "Every day (UTC)",
    );
    expect(
      describeSchedule({
        ...base,
        intervalValue: 2,
        intervalUnit: "WEEKS",
        windowStartMinute: 120,
        windowEndMinute: 240,
        timezone: "America/Costa_Rica",
      }),
    ).toBe("Every 2 weeks, between 02:00 and 04:00 (America/Costa_Rica)");
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/admin/users?status=PENDING")).toBe("/admin/users?status=PENDING");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("rejects anything that could leave the site", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "admin",
      "",
      null,
      42,
    ]) {
      expect(safeRedirectPath(value, "/fallback")).toBe("/fallback");
    }
  });
});
