"use server";

import { AuthError, CredentialsSignin } from "next-auth";

import { signIn, signOut } from "@/auth";
import { safeRedirectPath } from "@/features/auth/dal";
import { UserActionError } from "@/features/auth/errors";
import { registerUser } from "@/features/auth/users";

export type FormState = { error?: string; message?: string } | undefined;

const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: "Wrong email or password.",
  pending: "Your account is waiting for an administrator to approve it.",
  revoked: "Your access has been revoked. Contact the building administrator.",
  too_many_attempts: "Too many failed attempts. Try again in 15 minutes.",
};

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeRedirectPath(formData.get("next")),
    });
  } catch (error) {
    // signIn redirects by throwing on success; only auth failures are handled here.
    if (error instanceof CredentialsSignin) {
      return { error: LOGIN_ERRORS[error.code] ?? LOGIN_ERRORS.invalid_credentials };
    }
    if (error instanceof AuthError) return { error: "Sign-in failed. Try again." };
    throw error;
  }
}

export async function registerAction(_state: FormState, formData: FormData): Promise<FormState> {
  const password = formData.get("password");
  if (password !== formData.get("confirmPassword")) return { error: "Passwords do not match." };
  try {
    await registerUser({
      email: String(formData.get("email") ?? "").trim(),
      password: String(password ?? ""),
      name: String(formData.get("name") ?? "").trim() || undefined,
    });
  } catch (error) {
    if (!(error instanceof UserActionError)) throw error;
    // Same answer for an existing email, so the form can't be used to find accounts.
    if (error.code !== "email_taken") return { error: error.message };
  }
  return {
    message: "Registration received. You can sign in once an administrator approves your account.",
  };
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
