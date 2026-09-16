"use client";

import { useState, useTransition } from "react";

import { saveSettingsAction } from "@/app/admin/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { RotationSettingsView } from "@/features/rotation/settings";
import type { INTERVAL_UNITS } from "@/lib/db/models";

import { minutesToTime, timeToMinutes } from "../format";

type Unit = (typeof INTERVAL_UNITS)[number];

export function SettingsForm({
  settings,
  timeZones,
}: {
  settings: RotationSettingsView | null;
  timeZones: string[];
}) {
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [intervalValue, setIntervalValue] = useState(String(settings?.intervalValue ?? 7));
  const [intervalUnit, setIntervalUnit] = useState<Unit>(settings?.intervalUnit ?? "DAYS");
  const [useWindow, setUseWindow] = useState(settings?.windowStartMinute != null);
  const [windowStart, setWindowStart] = useState(minutesToTime(settings?.windowStartMinute ?? 120));
  const [windowEnd, setWindowEnd] = useState(minutesToTime(settings?.windowEndMinute ?? 300));
  const [timezone, setTimezone] = useState(settings?.timezone ?? "UTC");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const start = useWindow ? timeToMinutes(windowStart) : null;
    const end = useWindow ? timeToMinutes(windowEnd) : null;
    if (useWindow && (start === null || end === null)) {
      return setResult({ ok: false, text: "Enter both window times as HH:MM." });
    }
    startTransition(async () => {
      setResult(null);
      const response = await saveSettingsAction(
        {
          enabled,
          intervalValue: Number(intervalValue),
          intervalUnit,
          windowStartMinute: start,
          windowEndMinute: end,
          timezone,
        },
        settings ? settings.version : null,
      );
      setResult(
        response.ok ? { ok: true, text: "Settings saved." } : { ok: false, text: response.error },
      );
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Rotate the password automatically
      </label>

      <fieldset className="grid gap-1.5" disabled={!enabled}>
        <legend className="mb-1.5 text-sm font-medium">Rotate every</legend>
        <div className="flex gap-2">
          <Input
            aria-label="Interval"
            type="number"
            min={1}
            step={1}
            required
            className="w-24"
            value={intervalValue}
            onChange={(e) => setIntervalValue(e.target.value)}
          />
          <NativeSelect
            aria-label="Interval unit"
            value={intervalUnit}
            onChange={(e) => setIntervalUnit(e.target.value as Unit)}
          >
            <NativeSelectOption value="HOURS">hours</NativeSelectOption>
            <NativeSelectOption value="DAYS">days</NativeSelectOption>
            <NativeSelectOption value="WEEKS">weeks</NativeSelectOption>
          </NativeSelect>
        </div>
      </fieldset>

      <fieldset className="grid gap-2" disabled={!enabled}>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={useWindow}
            onChange={(e) => setUseWindow(e.target.checked)}
          />
          Only rotate during a time window
        </label>
        <p className="text-xs text-muted-foreground">
          For example overnight, so nobody is disconnected while working. The window can cross
          midnight.
        </p>
        {useWindow && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>From</span>
            <Input
              aria-label="Window start"
              type="time"
              required
              className="w-32"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
            <span>to</span>
            <Input
              aria-label="Window end"
              type="time"
              required
              className="w-32"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </div>
        )}
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="timezone" className="text-sm font-medium">
          Time zone
        </label>
        <NativeSelect
          id="timezone"
          className="w-full max-w-xs"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {timeZones.map((zone) => (
            <NativeSelectOption key={zone} value={zone}>
              {zone}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          Used for the rotation window.{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          >
            Use my time zone
          </button>
        </p>
      </div>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"}>
          <AlertDescription>{result.text}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : settings ? "Save changes" : "Save and start rotating"}
        </Button>
      </div>
    </form>
  );
}
