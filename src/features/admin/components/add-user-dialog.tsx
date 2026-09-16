"use client";

import { UserPlusIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { provisionUserAction } from "@/app/admin/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/password-rules";
import type { Role } from "@/features/auth/types";

export function AddUserDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await provisionUserAction({
        email: String(form.get("email")).trim(),
        name: String(form.get("name")).trim() || undefined,
        password: String(form.get("password")),
        role: form.get("role") as Role,
      });
      if (!result.ok) return setError(result.error);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), setError(null))}>
      <DialogTrigger render={<Button />}>
        <UserPlusIcon />
        Add user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            The account is active right away. Give the person their initial password in person or
            through a private channel.
          </DialogDescription>
        </DialogHeader>
        <form id="add-user" onSubmit={submit} className="grid gap-3">
          <Input name="email" type="email" placeholder="Email" aria-label="Email" required />
          <Input name="name" placeholder="Name (optional)" aria-label="Name" maxLength={100} />
          <Input
            name="password"
            type="password"
            placeholder={`Initial password (min. ${MIN_PASSWORD_LENGTH} characters)`}
            aria-label="Initial password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <NativeSelect name="role" aria-label="Role" defaultValue="USER" className="w-full">
            <NativeSelectOption value="USER">User: can get the network password</NativeSelectOption>
            <NativeSelectOption value="ADMIN">Admin: can manage everything</NativeSelectOption>
          </NativeSelect>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="add-user" disabled={pending}>
            {pending ? "Adding…" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
