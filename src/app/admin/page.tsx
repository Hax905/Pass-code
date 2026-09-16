import { AlertTriangleIcon, InfoIcon } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnomalies } from "@/features/admin/activity";
import { LocalTime } from "@/features/admin/components/local-time";
import { RevealPassword } from "@/features/admin/components/reveal-password";
import { RotateNowButton } from "@/features/admin/components/rotate-now-button";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { describeSchedule } from "@/features/admin/format";
import { requirePageAccess } from "@/features/auth/dal";
import { getRotationSettings, getRotationStatus } from "@/features/rotation/settings";

import { PageHeader } from "./page-header";

export default async function DashboardPage() {
  await requirePageAccess("admin", "/admin");
  const [status, settings, anomalies] = await Promise.all([
    getRotationStatus(),
    getRotationSettings(),
    getAnomalies(),
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Network password status and things that need attention."
      />

      {anomalies.length > 0 && (
        <section className="grid gap-3" aria-label="Alerts">
          {anomalies.map((anomaly) => (
            <Alert
              key={anomaly.title + anomaly.detail}
              variant={anomaly.level === "warning" ? "destructive" : "default"}
            >
              {anomaly.level === "warning" ? <AlertTriangleIcon /> : <InfoIcon />}
              <AlertTitle>{anomaly.title}</AlertTitle>
              <AlertDescription>
                {anomaly.detail}{" "}
                {anomaly.href && (
                  <Link href={anomaly.href} className="underline underline-offset-4">
                    View
                  </Link>
                )}
              </AlertDescription>
            </Alert>
          ))}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rotation</CardTitle>
            <CardDescription>
              {settings ? (
                settings.enabled ? (
                  describeSchedule(settings)
                ) : (
                  "Scheduled rotation is paused."
                )
              ) : (
                <>
                  Not configured yet: nothing rotates automatically until you{" "}
                  <Link href="/admin/rotation" className="underline underline-offset-4">
                    save a schedule
                  </Link>
                  .
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Last rotation</dt>
              <dd>
                {status.lastEvent ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <LocalTime date={status.lastEvent.createdAt} relative />
                    <StatusBadge status={status.lastEvent.status} />
                  </span>
                ) : (
                  "Never"
                )}
              </dd>
              <dt className="text-muted-foreground">Current password since</dt>
              <dd>
                {status.lastSuccess ? (
                  <LocalTime date={status.lastSuccess.createdAt} />
                ) : (
                  "No password yet"
                )}
              </dd>
              <dt className="text-muted-foreground">Next rotation</dt>
              <dd>
                {status.nextDueAt ? (
                  status.nextDueAt <= new Date() ? (
                    "Due now (at the next scheduler check inside the rotation window)"
                  ) : (
                    <LocalTime date={status.nextDueAt} relative />
                  )
                ) : (
                  "Not scheduled"
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current password</CardTitle>
            <CardDescription>
              Revealing it is logged. Rotating creates a new one right away.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-start gap-4">
            <RevealPassword />
            <RotateNowButton />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
