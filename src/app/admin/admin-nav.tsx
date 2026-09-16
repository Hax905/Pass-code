"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/rotation", label: "Rotation" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/requests", label: "Password requests" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {LINKS.map(({ href, label }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted",
              active ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
