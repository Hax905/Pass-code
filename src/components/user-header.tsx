import Link from "next/link";

import { logoutAction } from "@/app/(auth)/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/features/auth/dal";

const TABS = [
  { href: "/chat", key: "chat", label: "Assistant" },
  { href: "/network", key: "network", label: "Network" },
] as const;

/** Shared header for the two user-facing pages, with the tabs between them. */
export async function UserHeader({ active }: { active: (typeof TABS)[number]["key"] }) {
  const user = await getSessionUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          PassCode
        </Link>
        <nav aria-label="Sections" className="flex items-center gap-1">
          {TABS.map((tab) => (
            <Button
              key={tab.key}
              variant={tab.key === active ? "secondary" : "ghost"}
              size="sm"
              nativeButton={false}
              aria-current={tab.key === active ? "page" : undefined}
              render={<Link href={tab.href} />}
            >
              {tab.label}
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <ThemeToggle />
          {user ? (
            <>
              {user.role === "ADMIN" && (
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/admin" />}
                >
                  Admin
                </Button>
              )}
              <span className="text-muted-foreground">{user.email}</span>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button size="sm" nativeButton={false} render={<Link href={`/login?next=/chat`} />}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
