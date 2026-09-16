import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser, safeRedirectPath } from "@/features/auth/dal";

import { AuthCard } from "../auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PassCode" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = safeRedirectPath(next);
  if (await getSessionUser()) redirect(nextPath);

  return (
    <AuthCard title="Sign in" description="Use the account your building administrator set up.">
      <LoginForm next={nextPath} />
    </AuthCard>
  );
}
