import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/features/auth/dal";

import { logoutAction } from "../(auth)/actions";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = { title: "Assistant · PassCode" };

// Open to everyone: the chat API decides what each person gets, and people
// who aren't signed in receive a fixed explanation (PRD Flow D).
export default async function ChatPage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            PassCode <span className="font-normal text-muted-foreground">Assistant</span>
          </Link>
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
              <Button size="sm" nativeButton={false} render={<Link href="/login?next=/chat" />}>
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">
        <ChatClient signedIn={user !== null} name={user?.name} />
      </main>
    </div>
  );
}
