"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { rotateNowAction } from "@/app/admin/actions";
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

export function RotateNowButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function rotate() {
    startTransition(async () => {
      setResult(null);
      const response = await rotateNowAction();
      if (!response.ok) return setResult({ ok: false, text: response.error });
      const rotation = response.data;
      setResult(
        rotation.status === "SUCCEEDED"
          ? {
              ok: true,
              text: rotation.manualApplicationRequired
                ? "New password created. Reveal it and enter it on the router."
                : "Password rotated.",
            }
          : { ok: false, text: `Rotation failed: ${rotation.errorMessage}` },
      );
    });
  }

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger render={<Button disabled={pending} />}>
          <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
          {pending ? "Rotating…" : "Rotate now"}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the network password now?</AlertDialogTitle>
            <AlertDialogDescription>
              A new password is created immediately. Everyone on the network must reconnect with it,
              and people who got the old one informally lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={rotate}>Rotate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {result && (
        <p className={result.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {result.text}
        </p>
      )}
    </div>
  );
}
