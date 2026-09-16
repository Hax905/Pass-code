import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/features/auth/dal";

import { logoutAction } from "../(auth)/actions";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = {
  title: { default: "Admin · PassCode", template: "%s · PassCode" },
};

// Only the shell. Access is checked by every page and action (see features/auth/dal.ts).
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="font-semibold tracking-tight">
            PassCode <span className="font-normal text-muted-foreground">Admin</span>
          </Link>
          <AdminNav />
          {user && (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{user.email}</span>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
