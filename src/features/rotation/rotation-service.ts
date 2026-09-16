// Rotation execution (PRD §6.1): generate → store encrypted → apply via the
// RouterAdapter (one retry) → record the outcome in rotation_events + audit_log.
//
// The encrypted password is stored *before* it is applied, so a password that
// reaches the router is never lost if the process dies mid-rotation. Only
// SUCCEEDED events count as the current password.
import mongoose, { type Types } from "mongoose";

import type { AuthorizedUser } from "@/features/auth/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { connectDb } from "@/lib/db/connection";
import { AuditLog, RotationEvent, type ROTATION_TRIGGERS } from "@/lib/db/models";
import { getRotationEnv } from "@/lib/env";

import { generatePassword } from "./password-generator";
import { createRouterAdapter, type RouterAdapter } from "./router-adapter";

export const MAX_APPLY_ATTEMPTS = 2; // first try + one retry
export const APPLY_TIMEOUT_MS = 30_000;
// A PENDING rotation older than this was interrupted (crash, deploy) and would
// otherwise block every future rotation.
export const STALE_ROTATION_MS = 10 * 60 * 1000;

export class RotationInProgressError extends Error {
  constructor() {
    super("Another password rotation is already in progress");
    this.name = "RotationInProgressError";
  }
}

export interface RotateOptions {
  trigger: (typeof ROTATION_TRIGGERS)[number];
  /** Admin who requested a manual rotation. */
  triggeredBy?: Types.ObjectId | string;
  /** Where the request came from, for the audit log (e.g. "cli", "scheduler"). */
  source?: string;
  adapter?: RouterAdapter;
  encryptionKey?: Buffer;
  generate?: () => string;
  retryDelayMs?: number;
  applyTimeoutMs?: number;
}

export interface RotationResult {
  eventId: string;
  status: "SUCCEEDED" | "FAILED";
  attempts: number;
  manualApplicationRequired?: boolean;
  errorMessage?: string;
}

type ApplyOutcome =
  | { ok: true; attempts: number; manualApplicationRequired: boolean }
  | { ok: false; attempts: number; errorMessage: string };

/** Calls the adapter, retrying once. Never throws; never leaks the password in the error. */
export async function applyWithRetry(
  adapter: RouterAdapter,
  password: string,
  { retryDelayMs = 5_000, timeoutMs = APPLY_TIMEOUT_MS } = {},
): Promise<ApplyOutcome> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_APPLY_ATTEMPTS; attempt++) {
    try {
      const result = await withTimeout(adapter.applyPassword(password), timeoutMs);
      return { ok: true, attempts: attempt, ...result };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_APPLY_ATTEMPTS) await delay(retryDelayMs);
    }
  }
  return {
    ok: false,
    attempts: MAX_APPLY_ATTEMPTS,
    errorMessage: describeError(lastError, password),
  };
}

export async function rotateNetworkPassword(options: RotateOptions): Promise<RotationResult> {
  const adapter = options.adapter ?? createRouterAdapter(getRotationEnv().ROUTER_ADAPTER);
  const key = options.encryptionKey ?? getRotationEnv().PASSCODE_ENCRYPTION_KEY;
  const password = (options.generate ?? generatePassword)();

  await connectDb();
  await failStaleRotations();

  let eventId: Types.ObjectId;
  try {
    const event = await RotationEvent.create({
      trigger: options.trigger,
      triggeredBy: options.triggeredBy,
      adapter: adapter.name,
      status: "PENDING",
      passwordCiphertext: encryptSecret(password, key),
    });
    eventId = event._id;
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new RotationInProgressError();
    throw error;
  }

  const outcome = await applyWithRetry(adapter, password, {
    retryDelayMs: options.retryDelayMs,
    timeoutMs: options.applyTimeoutMs,
  });
  const status = outcome.ok ? "SUCCEEDED" : "FAILED";

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await RotationEvent.updateOne(
        { _id: eventId },
        outcome.ok
          ? {
              status,
              attempts: outcome.attempts,
              manualApplicationRequired: outcome.manualApplicationRequired,
              completedAt: new Date(),
            }
          : {
              status,
              attempts: outcome.attempts,
              errorMessage: outcome.errorMessage,
              completedAt: new Date(),
            },
        { session },
      );
      await AuditLog.create(
        [
          {
            actor: options.triggeredBy,
            action: outcome.ok ? "rotation.succeeded" : "rotation.failed",
            target: eventId.toString(),
            metadata: {
              trigger: options.trigger,
              source: options.source,
              adapter: adapter.name,
              attempts: outcome.attempts,
            },
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return {
    eventId: eventId.toString(),
    status,
    attempts: outcome.attempts,
    ...(outcome.ok
      ? { manualApplicationRequired: outcome.manualApplicationRequired }
      : { errorMessage: outcome.errorMessage }),
  };
}

/** Marks rotations left PENDING by a crashed process as FAILED. */
export async function failStaleRotations(now = new Date()): Promise<number> {
  await connectDb();
  const { modifiedCount } = await RotationEvent.updateMany(
    { status: "PENDING", createdAt: { $lt: new Date(now.getTime() - STALE_ROTATION_MS) } },
    {
      status: "FAILED",
      errorMessage: "Rotation was interrupted before completing",
      completedAt: now,
    },
  );
  return modifiedCount;
}

/**
 * Decrypts the password from the latest successful rotation. Callers that show
 * it to a person must log that disclosure (password_requests / audit_log).
 */
export async function getCurrentNetworkPassword(
  encryptionKey = getRotationEnv().PASSCODE_ENCRYPTION_KEY,
): Promise<{ password: string; eventId: string; rotatedAt: Date } | null> {
  await connectDb();
  const event = await RotationEvent.findOne({ status: "SUCCEEDED" })
    .sort({ createdAt: -1 })
    .select("+passwordCiphertext")
    .lean();
  if (!event?.passwordCiphertext) return null;
  return {
    password: decryptSecret(event.passwordCiphertext, encryptionKey),
    eventId: event._id.toString(),
    rotatedAt: event.completedAt ?? event.createdAt,
  };
}

/**
 * Shows the current password to an admin (STYLES.md §1: a sensitive, logged
 * action). The disclosure is written to audit_log before the password is returned.
 */
export async function revealCurrentPassword(
  actor: AuthorizedUser,
  meta: { source?: string } = {},
): Promise<{ password: string; eventId: string; rotatedAt: Date } | null> {
  if (actor.role !== "ADMIN") throw new Error("Admin privileges required");
  const current = await getCurrentNetworkPassword();
  await AuditLog.create({
    actor: actor.id,
    action: current ? "password.viewed" : "password.view_empty",
    target: current?.eventId,
    metadata: { source: meta.source },
  });
  return current;
}

function describeError(error: unknown, password: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(password).join("[redacted]").slice(0, 500) || "Unknown error";
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Router did not respond within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
