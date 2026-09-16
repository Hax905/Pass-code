"use client";

import { CopyIcon, EyeOffIcon, KeyRoundIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Turn = {
  role: "user" | "assistant";
  content: string;
  reveal?: { password: string; rotatedAt: string };
  /** A refused, rate-limited or failed exchange: shown, but not sent back as history. */
  excluded?: boolean;
  /** The server refused because the person isn't signed in (or was revoked). */
  denied?: boolean;
};

// Keep in sync with the server's limits in features/chat/chat-service.ts.
const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 2000;
const REVEAL_SECONDS = 60;

const SUGGESTIONS = [
  "What's the Wi-Fi password?",
  "Why did the password change?",
  "How do I connect my phone?",
  "Who do I contact about network problems?",
];

export function ChatClient({ signedIn, name }: { signedIn: boolean; name?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setInput("");
    setError(null);
    setPending(true);

    // Only plain text goes back to the server; a shown password never does.
    let history = next.filter((t) => !t.excluded).map(({ role, content }) => ({ role, content }));
    while (history.length > MAX_TURNS || history[0]?.role !== "user") history = history.slice(1);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = (await response.json().catch(() => null)) as {
        reply?: string;
        reveal?: Turn["reveal"];
        denied?: string;
        message?: string;
      } | null;
      if (!data?.reply) {
        throw new Error(data?.message ?? "The assistant didn't answer. Please try again.");
      }
      const excluded = !response.ok;
      setTurns([
        ...turns,
        { role: "user", content, excluded },
        {
          role: "assistant",
          content: data.reply,
          reveal: data.reveal,
          excluded,
          denied: Boolean(data.denied),
        },
      ]);
    } catch (err) {
      setTurns(turns);
      setInput(content);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex-1 space-y-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-4 py-8 text-center">
            <KeyRoundIcon className="mx-auto size-8 text-muted-foreground" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                {name ? `Hi ${name}, how can I help?` : "How can I help?"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Ask for the current Wi-Fi password or anything about the building network.
                {!signedIn && " You need to sign in to get the password."}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => send(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                turn.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                  : "max-w-[85%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap"
              }
            >
              <p>{turn.content}</p>
              {turn.reveal && <PasswordPanel reveal={turn.reveal} />}
              {turn.denied && !signedIn && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" nativeButton={false} render={<Link href="/login?next=/chat" />}>
                    Sign in
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/register" />}
                  >
                    Request access
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <form
        className="sticky bottom-0 flex gap-2 bg-background py-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <Input
          aria-label="Message"
          placeholder="Ask about the Wi-Fi…"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(event) => setInput(event.target.value)}
          disabled={pending}
          autoFocus
        />
        <Button type="submit" disabled={pending || !input.trim()} aria-label="Send">
          <SendIcon />
        </Button>
      </form>
    </div>
  );
}

function PasswordPanel({ reveal }: { reveal: NonNullable<Turn["reveal"]> }) {
  const [hiddenByUser, setHiddenByUser] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);
  const [copied, setCopied] = useState(false);
  const visible = !hiddenByUser && secondsLeft > 0;

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        The password was hidden. Ask again if you need it (each request is logged).
      </p>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-background p-3 whitespace-normal">
      <div className="text-xs text-muted-foreground">Current Wi-Fi password</div>
      <div className="flex items-center gap-2">
        <code className="font-mono text-base tracking-wide break-all select-all">
          {reveal.password}
        </code>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Copy password"
          onClick={() =>
            navigator.clipboard
              .writeText(reveal.password)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          <CopyIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide password"
          onClick={() => setHiddenByUser(true)}
        >
          <EyeOffIcon />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {copied ? "Copied. " : ""}Please don&apos;t share it: anyone who needs access can request
        their own account. Hides in {secondsLeft} s.
      </p>
    </div>
  );
}
