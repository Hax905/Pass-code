import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ANOMALY_THRESHOLDS, listPasswordRequests } from "@/features/admin/activity";
import { LocalTime } from "@/features/admin/components/local-time";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { requirePageAccess } from "@/features/auth/dal";
import { cn } from "cn";

import { PageHeader } from "../page-header";

export const metadata: Metadata = { title: "Password requests" };

const DENIAL_LABELS = {
  UNAUTHENTICATED: "Not signed in",
  NOT_AUTHORIZED: "Not authorized",
  REVOKED: "Access revoked",
  RATE_LIMITED: "Too many requests",
} as const;

const FILTERS = [
  { value: undefined, label: "All" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
] as const;

export default async function RequestsPage({ searchParams }: PageProps<"/admin/requests">) {
  await requirePageAccess("admin", "/admin/requests");
  const { show } = await searchParams;
  const requests = await listPasswordRequests(
    show === "granted" ? { granted: true } : show === "denied" ? { granted: false } : {},
    200,
  );

  return (
    <>
      <PageHeader
        title="Password requests"
        description="Who asked the assistant for the network password, and whether they got it."
      />

      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Filter requests">
        {FILTERS.map((filter) => {
          const active = show === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/admin/requests?show=${filter.value}` : "/admin/requests"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md border px-2.5 py-1 transition-colors hover:bg-muted",
                active ? "bg-muted font-medium" : "text-muted-foreground",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>Latest requests</CardTitle>
          <CardDescription>
            Someone asking more than {ANOMALY_THRESHOLDS.userRequestsPerDay} times a day is flagged
            on the dashboard: they may be passing the password on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requests yet. They appear here once people use the assistant.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>IP address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <LocalTime date={request.createdAt} />
                    </TableCell>
                    <TableCell>
                      {request.user?.email ?? (
                        <span className="text-muted-foreground">Not signed in</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={request.granted ? "GRANTED" : "DENIED"} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {request.denialReason ? DENIAL_LABELS[request.denialReason] : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {request.sourceIp ?? ""}
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
