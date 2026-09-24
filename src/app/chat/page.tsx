import type { Metadata } from "next";

import { UserHeader } from "@/components/user-header";
import { getSessionUser } from "@/features/auth/dal";

import { ChatClient } from "./chat-client";

export const metadata: Metadata = { title: "Assistant · PassCode" };

// Open to everyone: the chat API decides what each person gets, and people
// who aren't signed in receive a fixed explanation (PRD Flow D).
export default async function ChatPage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <UserHeader active="chat" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">
        <ChatClient signedIn={user !== null} name={user?.name} />
      </main>
    </div>
  );
}
