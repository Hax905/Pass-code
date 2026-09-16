"use client";

import { useState, useTransition } from "react";

import {
  approveUserAction,
  changeRoleAction,
  reinstateUserAction,
  resetPasswordAction,
  revokeUserAction,
} from "@/app/admin/actions";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/password-rules";
import type { PublicUser } from "@/features/auth/types";

type Result = { ok: true } | { ok: false; error: string };

export function UserActions({ user, isSelf }: { user: PublicUser; isSelf: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<Result>) {
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }

  const label = user.name ? `${user.name} (${user.email})` : user.email;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {user.status === "PENDING" && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => approveUserAction(user.id))}
          >
            Approve
          </Button>
        )}
        {user.status === "REVOKED" && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => reinstateUserAction(user.id))}
          >
            Reinstate
          </Button>
        )}
        {user.status === "ACTIVE" && !isSelf && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() => changeRoleAction(user.id, user.role === "ADMIN" ? "USER" : "ADMIN"))
            }
          >
            {user.role === "ADMIN" ? "Make user" : "Make admin"}
          </Button>
        )}
        {user.status !== "REVOKED" && (
          <ResetPasswordDialog
            label={label}
            disabled={pending}
            onSubmit={(pw) => resetPasswordAction(user.id, pw)}
          />
        )}
        {user.status !== "REVOKED" && !isSelf && (
          <RevokeDialog
            label={label}
            pending={user.status === "PENDING"}
            disabled={pending}
            onConfirm={(reason) => run(() => revokeUserAction(user.id, reason))}
          />
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RevokeDialog({
  label,
  pending,
  disabled,
  onConfirm,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  onConfirm: (reason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={disabled} />}>
        {pending ? "Reject" : "Revoke"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending ? "Reject" : "Revoke access for"} {label}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? "They won't be able to sign in. You can reinstate them later."
              : "They are signed out everywhere immediately and can no longer get the network password. You can reinstate them later."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          aria-label="Reason (optional)"
          placeholder="Reason (optional, kept in the audit log)"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            {pending ? "Reject" : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResetPasswordDialog({
  label,
  disabled,
  onSubmit,
}: {
  label: string;
  disabled: boolean;
  onSubmit: (password: string) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    startTransition(async () => {
      setError(null);
      const result = await onSubmit(password);
      if (!result.ok) return setError(result.error);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setError(null))}>
      <DialogTrigger render={<Button size="sm" variant="outline" disabled={disabled} />}>
        Reset password
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {label}</DialogTitle>
          <DialogDescription>
            They are signed out everywhere and must sign in with the new password.
          </DialogDescription>
        </DialogHeader>
        <form id="reset-password" onSubmit={submit} className="grid gap-3">
          <Input
            name="password"
            type="password"
            aria-label="New password"
            placeholder={`New password (min. ${MIN_PASSWORD_LENGTH} characters)`}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="reset-password" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
