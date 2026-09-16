"use client";

/** Shows a timestamp in the viewer's own time zone and locale. */
export function LocalTime({ date, relative = false }: { date: Date | string; relative?: boolean }) {
  const value = new Date(date);
  const text = relative ? formatRelative(value) : value.toLocaleString();
  return (
    // The server renders in its own time zone; the browser's rendering wins.
    <time dateTime={value.toISOString()} title={value.toLocaleString()} suppressHydrationWarning>
      {text}
    </time>
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function formatRelative(date: Date): string {
  const diff = date.getTime() - Date.now();
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return diff >= 0 ? "in less than a minute" : "just now";
}
