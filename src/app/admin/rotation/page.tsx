import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalTime } from "@/features/admin/components/local-time";
import { RotateNowButton } from "@/features/admin/components/rotate-now-button";
import { SettingsForm } from "@/features/admin/components/settings-form";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { requirePageAccess } from "@/features/auth/dal";
import { getRotationSettings, listRotationEvents } from "@/features/rotation/settings";

import { PageHeader } from "../page-header";

export const metadata: Metadata = { title: "Rotation" };

const TRIGGER_LABELS = { SCHEDULED: "Scheduled", MANUAL: "Manual" } as const;

export default async function RotationPage() {
  await requirePageAccess("admin", "/admin/rotation");
  const [settings, events] = await Promise.all([getRotationSettings(), listRotationEvents(100)]);
  const timeZones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")];
  if (settings && !timeZones.includes(settings.timezone)) timeZones.unshift(settings.timezone);

  return (
    <>
      <PageHeader
        title="Rotation"
        description="When the network password changes, and what happened each time."
      >
        <RotateNowButton />
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            {settings
              ? "Changes apply from the scheduler's next check (every minute)."
              : "Nothing rotates automatically until you save a schedule."}{" "}
            Scheduled rotation runs while the app server has{" "}
            <code className="text-xs">ROTATION_SCHEDULER_ENABLED=true</code> or{" "}
            <code className="text-xs">npm run rotation:worker</code> is running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={settings} timeZones={timeZones} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>
            The last {events.length === 100 ? "100 " : ""}rotations, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rotations yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <LocalTime date={event.createdAt} />
                    </TableCell>
                    <TableCell>
                      {TRIGGER_LABELS[event.trigger]}
                      {event.triggeredBy && (
                        <span className="text-muted-foreground"> by {event.triggeredBy.email}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={event.status} />
                    </TableCell>
                    <TableCell>{event.attempts}</TableCell>
                    <TableCell className="max-w-sm text-wrap text-muted-foreground">
                      {event.status === "FAILED"
                        ? event.errorMessage
                        : event.status === "SUCCEEDED"
                          ? "Applied to the virtual router"
                          : "In progress"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
