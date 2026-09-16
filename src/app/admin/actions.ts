"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { requireActionAccess, type ActionResult } from "@/features/auth/dal";
import { UserActionError } from "@/features/auth/errors";
import type { AuthorizedUser, Role } from "@/features/auth/types";
import * as users from "@/features/auth/users";
import {
  RotationInProgressError,
  revealCurrentPassword,
  rotateNetworkPassword,
  type RotationResult,
} from "@/features/rotation/rotation-service";
import {
  SettingsConflictError,
  saveRotationSettings,
  type RotationSettingsInput,
} from "@/features/rotation/settings";

// Server actions are public endpoints: each one checks admin access itself.

async function adminAction<T>(
  path: string,
  run: (admin: AuthorizedUser) => Promise<T>,
): Promise<ActionResult<T>> {
  const admin = await requireActionAccess("admin", path);
  if ("ok" in admin) return admin;
  try {
    const data = await run(admin);
    revalidatePath("/admin", "layout");
    return { ok: true, data };
  } catch (error) {
    if (
      error instanceof UserActionError ||
      error instanceof SettingsConflictError ||
      error instanceof RotationInProgressError
    ) {
      return { ok: false, error: error.message };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input" };
    }
    console.error(`[admin] ${path} failed:`, error);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

export async function saveSettingsAction(
  input: RotationSettingsInput,
  expectedVersion: number | null,
) {
  return adminAction("/admin/rotation", async (admin) => {
    await saveRotationSettings(admin, input, expectedVersion);
  });
}

export async function rotateNowAction(): Promise<ActionResult<RotationResult>> {
  return adminAction("/admin/rotation", (admin) =>
    rotateNetworkPassword({ trigger: "MANUAL", triggeredBy: admin.id, source: "admin-ui" }),
  );
}

export async function revealPasswordAction() {
  const admin = await requireActionAccess("admin", "/admin");
  if ("ok" in admin) return admin;
  const current = await revealCurrentPassword(admin, { source: "admin-ui" });
  // No revalidation: nothing on the page changes, and the password isn't cached anywhere.
  return {
    ok: true as const,
    data: current && { password: current.password, rotatedAt: current.rotatedAt },
  };
}

export async function provisionUserAction(input: {
  email: string;
  password: string;
  name?: string;
  role: Role;
}) {
  return adminAction("/admin/users", async (admin) => {
    await users.provisionUser(admin, input);
  });
}

export async function approveUserAction(userId: string) {
  return adminAction("/admin/users", async (admin) => {
    await users.approveUser(admin, userId);
  });
}

export async function revokeUserAction(userId: string, reason?: string) {
  return adminAction("/admin/users", async (admin) => {
    await users.revokeUser(admin, userId, reason);
  });
}

export async function reinstateUserAction(userId: string) {
  return adminAction("/admin/users", async (admin) => {
    await users.reinstateUser(admin, userId);
  });
}

export async function changeRoleAction(userId: string, role: Role) {
  return adminAction("/admin/users", async (admin) => {
    await users.changeUserRole(admin, userId, role);
  });
}

export async function resetPasswordAction(userId: string, password: string) {
  return adminAction("/admin/users", async (admin) => {
    await users.resetUserPassword(admin, userId, password);
  });
}
