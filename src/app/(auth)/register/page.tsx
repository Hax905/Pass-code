import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/features/auth/dal";

import { AuthCard } from "../auth-card";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Request access · PassCode" };

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/");

  return (
    <AuthCard
      title="Request access"
      description="An administrator must approve your account before you can sign in."
    >
      <RegisterForm />
    </AuthCard>
  );
}
