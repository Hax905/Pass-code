"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { loginAction } from "../actions";
import { FormField } from "../auth-card";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <FormField id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </FormField>
      <FormField id="password" label="Password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </FormField>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/register" className="text-foreground underline underline-offset-4">
          Request access
        </Link>
      </p>
    </form>
  );
}
