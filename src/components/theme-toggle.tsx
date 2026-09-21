"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useLayoutEffect } from "react";

import { Button } from "@/components/ui/button";

import { THEME_STORAGE_KEY } from "./theme-script";

function stored(): "light" | "dark" | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function apply(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Switches between light and dark, and remembers the choice.
 *
 * Deliberately holds no React state: both icons are always rendered and CSS
 * picks which one is visible, so the server's markup is correct under either
 * theme and there is nothing to hydrate-mismatch.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // React's dev-only Strict Mode remount resets <html> to the attributes it
  // manages from JSX, discarding the class the inline script set. Re-applying
  // before paint keeps development honest; in production this is a no-op.
  useLayoutEffect(() => {
    const choice = stored();
    apply(choice ? choice === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  // Until someone picks a side, follow the system if it changes mid-session.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (!stored()) apply(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const dark = !document.documentElement.classList.contains("dark");
    apply(dark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
    } catch {
      // A preference we cannot store still applies for this page view.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label="Switch between light and dark mode"
      title="Switch between light and dark mode"
      className={className}
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="block dark:hidden" />
    </Button>
  );
}
