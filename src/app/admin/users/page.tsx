import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddUserDialog } from "@/features/admin/components/add-user-dialog";
import { LocalTime } from "@/features/admin/components/local-time";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { UserActions } from "@/features/admin/components/user-actions";
import { requirePageAccess } from "@/features/auth/dal";
import type { UserStatus } from "@/features/auth/types";
import { listUsers } from "@/features/auth/users";
import { cn } from "cn";

import { PageHeader } from "../page-header";

export const metadata: Metadata = { title: "Users" };

const FILTERS: { value?: UserStatus; label: string }[] = [
  { label: "All" },
  { value: "PENDING", label: "Waiting for approval" },
  { value: "ACTIVE", label: "Active" },
  { value: "REVOKED", label: "Revoked" },
];

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requirePageAccess("admin", "/admin/users");
  const { status } = await searchParams;
  const allUsers = await listUsers(admin);
  const users = allUsers.filter((u) => !status || u.status === status);

  return (
    <>
      <PageHeader
        title="Users"
        description="People allowed to get the network password. Revoking takes effect immediately."
      >
        <AddUserDialog />
      </PageHeader>

      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const count = allUsers.filter((u) => !filter.value || u.status === filter.value).length;
          const active = (status ?? undefined) === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/admin/users?status=${filter.value}` : "/admin/users"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md border px-2.5 py-1 transition-colors hover:bg-muted",
                active ? "bg-muted font-medium" : "text-muted-foreground",
              )}
            >
              {filter.label} ({count})
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users here.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.name ?? user.email}</div>
                      {user.name && <div className="text-muted-foreground">{user.email}</div>}
                      {user.id === admin.id && (
                        <div className="text-xs text-muted-foreground">You</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.role === "ADMIN" ? "default" : "outline"}>
                        {user.role === "ADMIN" ? "Admin" : "User"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                      {user.revokedAt && (
                        <div className="text-xs text-muted-foreground">
                          <LocalTime date={user.revokedAt} relative />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <LocalTime date={user.createdAt} relative />
                    </TableCell>
                    <TableCell>
                      <UserActions user={user} isSelf={user.id === admin.id} />
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
