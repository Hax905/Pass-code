"use client";

import { CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { revealPasswordAction } from "@/app/admin/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const VISIBLE_SECONDS = 60;

/** Shows the current network password after a confirmation. Every reveal is audited. */
export function RevealPassword() {
  const [password, setPassword] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!password) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setPassword(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [password]);

  function reveal() {
    startTransition(async () => {
      setMessage(null);
      const result = await revealPasswordAction();
      if (!result.ok) return setMessage(result.error);
      if (!result.data) return setMessage("There is no password yet. Rotate once to create one.");
      setPassword(result.data.password);
      setSecondsLeft(VISIBLE_SECONDS);
    });
  }

  if (password) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="rounded-md border bg-muted px-3 py-2 font-mono text-base tracking-wide select-all">
            {password}
          </code>
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy password"
            onClick={() => navigator.clipboard.writeText(password).catch(() => undefined)}
          >
            <CopyIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hide password"
            onClick={() => setPassword(null)}
          >
            <EyeOffIcon />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Hides automatically in {secondsLeft} s.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline" disabled={pending} />}>
          <EyeIcon />
          {pending ? "Loading…" : "Reveal current password"}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reveal the network password?</AlertDialogTitle>
            <AlertDialogDescription>
              This is recorded in the audit log with your name. Only reveal it to enter it on the
              router or to help someone who is authorized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={reveal}>Reveal</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
