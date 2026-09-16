// User lifecycle (PRD §6.4, STYLES.md §2.4). Every change is written together
// with its audit_log entry in one transaction. Revoking, changing a role and
// resetting a password increment tokenVersion, which invalidates existing
// sessions on their next request.
import mongoose, { isValidObjectId, type ClientSession } from "mongoose";
import { z } from "zod";

import { connectDb } from "@/lib/db/connection";
import { AuditLog, ROLES, User } from "@/lib/db/models";

import { UserActionError } from "./errors";
import { checkPasswordPolicy, hashPassword } from "./password";
import type { AuthorizedUser, PublicUser, Role } from "./types";

const emailSchema = z.email().max(254);
const nameSchema = z.string().trim().min(1).max(100).optional();

export const newUserSchema = z.object({
  email: emailSchema,
  password: z.string(),
  name: nameSchema,
});
export type NewUserInput = z.infer<typeof newUserSchema>;

export const provisionUserSchema = newUserSchema.extend({
  role: z.enum(ROLES).default("USER"),
});
export type ProvisionUserInput = z.input<typeof provisionUserSchema>;

type UserDoc = {
  _id: mongoose.Types.ObjectId;
  email: string;
  name?: string | null;
  role: Role;
  status: PublicUser["status"];
  createdAt: Date;
  revokedAt?: Date | null;
};

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    ...(user.name ? { name: user.name } : {}),
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    ...(user.revokedAt ? { revokedAt: user.revokedAt } : {}),
  };
}

/** Self-registration: the account stays PENDING until an admin approves it. */
export async function registerUser(input: NewUserInput): Promise<PublicUser> {
  const { email, password, name } = parse(newUserSchema, input);
  return createUser({ email, password, name, role: "USER", status: "PENDING" }, undefined, {
    action: "user.registered",
  });
}

/** Admin-provisioned account: active immediately. */
export async function provisionUser(
  actor: AuthorizedUser,
  input: ProvisionUserInput,
): Promise<PublicUser> {
  assertAdmin(actor);
  const { email, password, name, role } = parse(provisionUserSchema, input);
  return createUser({ email, password, name, role, status: "ACTIVE" }, actor, {
    action: "user.provisioned",
  });
}

/** First admin, created from the command line (`npm run user:create-admin`). */
export async function bootstrapAdmin(input: NewUserInput): Promise<PublicUser> {
  const { email, password, name } = parse(newUserSchema, input);
  return createUser({ email, password, name, role: "ADMIN", status: "ACTIVE" }, undefined, {
    action: "user.provisioned",
    metadata: { source: "cli" },
  });
}

export async function listUsers(actor: AuthorizedUser): Promise<PublicUser[]> {
  assertAdmin(actor);
  await connectDb();
  const users = await User.find().sort({ createdAt: -1 }).lean<UserDoc[]>();
  return users.map(toPublicUser);
}

export async function approveUser(actor: AuthorizedUser, userId: string): Promise<PublicUser> {
  assertAdmin(actor);
  return mutateUser(actor, userId, "user.approved", async (user, session) => {
    if (user.status !== "PENDING") {
      throw new UserActionError("invalid_status", "Only pending users can be approved");
    }
    return User.findByIdAndUpdate(
      user._id,
      { status: "ACTIVE" },
      { session, returnDocument: "after" },
    );
  });
}

/** Takes effect on the user's next request, not at the next rotation (PRD §8). */
export async function revokeUser(
  actor: AuthorizedUser,
  userId: string,
  reason?: string,
): Promise<PublicUser> {
  assertAdmin(actor);
  return mutateUser(
    actor,
    userId,
    "user.revoked",
    async (user, session) => {
      assertNotSelf(actor, user);
      if (user.status === "REVOKED") {
        throw new UserActionError("invalid_status", "User is already revoked");
      }
      if (user.role === "ADMIN") await assertAnotherActiveAdmin(user._id, session);
      return User.findByIdAndUpdate(
        user._id,
        { status: "REVOKED", revokedAt: new Date(), $inc: { tokenVersion: 1 } },
        { session, returnDocument: "after" },
      );
    },
    reason ? { reason: reason.slice(0, 500) } : undefined,
  );
}

/** Gives a revoked user access again (e.g. revoked by mistake). Old sessions stay invalid. */
export async function reinstateUser(actor: AuthorizedUser, userId: string): Promise<PublicUser> {
  assertAdmin(actor);
  return mutateUser(actor, userId, "user.reinstated", async (user, session) => {
    if (user.status !== "REVOKED") {
      throw new UserActionError("invalid_status", "Only revoked users can be reinstated");
    }
    return User.findByIdAndUpdate(
      user._id,
      { status: "ACTIVE", $unset: { revokedAt: 1 }, $inc: { tokenVersion: 1 } },
      { session, returnDocument: "after" },
    );
  });
}

export async function changeUserRole(
  actor: AuthorizedUser,
  userId: string,
  role: Role,
): Promise<PublicUser> {
  assertAdmin(actor);
  const newRole = parse(z.enum(ROLES), role);
  return mutateUser(
    actor,
    userId,
    "user.role_changed",
    async (user, session) => {
      assertNotSelf(actor, user);
      if (user.role === newRole) {
        throw new UserActionError("invalid_status", `User already has role ${newRole}`);
      }
      if (user.role === "ADMIN") await assertAnotherActiveAdmin(user._id, session);
      return User.findByIdAndUpdate(
        user._id,
        { role: newRole, $inc: { tokenVersion: 1 } },
        { session, returnDocument: "after" },
      );
    },
    { role: newRole },
  );
}

export async function resetUserPassword(
  actor: AuthorizedUser,
  userId: string,
  newPassword: string,
): Promise<PublicUser> {
  assertAdmin(actor);
  return mutateUser(actor, userId, "user.password_reset", async (user, session) => {
    assertPassword(newPassword, user.email);
    return User.findByIdAndUpdate(
      user._id,
      { passwordHash: await hashPassword(newPassword), $inc: { tokenVersion: 1 } },
      { session, returnDocument: "after" },
    );
  });
}

// --- helpers ---------------------------------------------------------------

async function createUser(
  fields: NewUserInput & { role: Role; status: "PENDING" | "ACTIVE" },
  actor: AuthorizedUser | undefined,
  audit: { action: string; metadata?: Record<string, unknown> },
): Promise<PublicUser> {
  assertPassword(fields.password, fields.email);
  const passwordHash = await hashPassword(fields.password);
  await connectDb();
  try {
    return await inTransaction(async (session) => {
      const [user] = await User.create(
        [
          {
            email: fields.email,
            name: fields.name,
            role: fields.role,
            status: fields.status,
            passwordHash,
          },
        ],
        { session },
      );
      await writeAudit(session, actor, audit.action, user._id, {
        role: fields.role,
        status: fields.status,
        ...audit.metadata,
      });
      return toPublicUser(user.toObject() as UserDoc);
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000) {
      throw new UserActionError("email_taken", "An account with this email already exists");
    }
    throw error;
  }
}

async function mutateUser(
  actor: AuthorizedUser,
  userId: string,
  action: string,
  change: (user: UserDoc, session: ClientSession) => Promise<unknown>,
  metadata?: Record<string, unknown>,
): Promise<PublicUser> {
  if (!isValidObjectId(userId)) throw new UserActionError("user_not_found", "User not found");
  await connectDb();
  return inTransaction(async (session) => {
    const user = await User.findById(userId).session(session).lean<UserDoc>();
    if (!user) throw new UserActionError("user_not_found", "User not found");
    const updated = (await change(user, session)) as { toObject(): UserDoc } | null;
    if (!updated) throw new UserActionError("user_not_found", "User not found");
    await writeAudit(session, actor, action, user._id, {
      email: user.email,
      previousStatus: user.status,
      previousRole: user.role,
      ...metadata,
    });
    return toPublicUser(updated.toObject());
  });
}

async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

function writeAudit(
  session: ClientSession,
  actor: AuthorizedUser | undefined,
  action: string,
  target: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>,
) {
  return AuditLog.create([{ actor: actor?.id, action, target: target.toString(), metadata }], {
    session,
  });
}

async function assertAnotherActiveAdmin(
  excludeId: mongoose.Types.ObjectId,
  session: ClientSession,
) {
  const others = await User.countDocuments({
    _id: { $ne: excludeId },
    role: "ADMIN",
    status: "ACTIVE",
  }).session(session);
  if (others === 0) {
    throw new UserActionError("last_admin", "The last active admin cannot be removed or demoted");
  }
}

function assertAdmin(actor: AuthorizedUser) {
  // Routes already enforce this; checked again so a wiring mistake can't skip it.
  if (actor.role !== "ADMIN") throw new Error("Admin privileges required");
}

function assertNotSelf(actor: AuthorizedUser, user: UserDoc) {
  if (user._id.toString() === actor.id) {
    throw new UserActionError("cannot_modify_self", "Admins cannot revoke or demote themselves");
  }
}

function assertPassword(password: string, email: string) {
  const problem = checkPasswordPolicy(password, email);
  if (problem) throw new UserActionError("invalid_input", problem);
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`);
    throw new UserActionError("invalid_input", message.join("; "));
  }
  return result.data;
}
