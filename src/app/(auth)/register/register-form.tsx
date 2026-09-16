"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/password-rules";

import { registerAction } from "../actions";
import { FormField } from "../auth-card";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, undefined);

  if (state?.message) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button nativeButton={false} render={<Link href="/login" />}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <FormField id="name" label="Name (optional)">
        <Input id="name" name="name" autoComplete="name" maxLength={100} />
      </FormField>
      <FormField id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>
      <FormField id="password" label={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </FormField>
      <FormField id="confirmPassword" label="Repeat password">
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </FormField>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Request access"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already approved?{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
