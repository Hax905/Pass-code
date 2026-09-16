// NetGuard data model — see STYLES.md §2.3 (pivoted to MongoDB, see TASKLIST.md Phase 0 log).
// Collection names match the table names STYLES.md defines.
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const ROLES = ["ADMIN", "USER"] as const;
// PENDING = self-registered, awaiting admin approval (STYLES.md §1).
export const USER_STATUSES = ["PENDING", "ACTIVE", "REVOKED"] as const;
export const ROTATION_TRIGGERS = ["SCHEDULED", "MANUAL"] as const;
export const ROTATION_STATUSES = ["PENDING", "SUCCEEDED", "FAILED"] as const;
export const INTERVAL_UNITS = ["HOURS", "DAYS", "WEEKS"] as const;
export const DENIAL_REASONS = [
  "UNAUTHENTICATED",
  "NOT_AUTHORIZED",
  "REVOKED",
  "RATE_LIMITED",
] as const;

// Reuse compiled models across Next.js dev hot reloads.
function model<TSchema extends Schema>(name: string, schema: TSchema, collection: string) {
  return (mongoose.models[name] ?? mongoose.model(name, schema, collection)) as Model<
    InferSchemaType<TSchema>
  >;
}

const userSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, trim: true },
    role: { type: String, enum: ROLES, required: true, default: "USER" },
    status: { type: String, enum: USER_STATUSES, required: true, default: "PENDING" },
    // Optional so SSO-only accounts can be added later without a rewrite.
    // select: false keeps the hash out of every query unless explicitly asked for.
    passwordHash: { type: String, select: false },
    // Incremented on revoke / role change / password reset. Every protected
    // request compares the session's token version against this value, so a
    // revocation takes effect immediately even though sessions are JWTs.
    tokenVersion: { type: Number, required: true, default: 0, min: 0 },
    revokedAt: { type: Date },
  },
  { timestamps: true, strict: "throw" },
);
userSchema.index({ email: 1 }, { unique: true });

const rotationEventSchema = new Schema(
  {
    trigger: { type: String, enum: ROTATION_TRIGGERS, required: true },
    // Admin who started a MANUAL rotation; absent for scheduled and CLI rotations.
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ROTATION_STATUSES, required: true, default: "PENDING" },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    adapter: { type: String, required: true }, // RouterAdapter implementation, e.g. "mock"
    errorMessage: { type: String },
    // Set on success: true when someone must still enter the password on the device.
    manualApplicationRequired: { type: Boolean },
    // Application-level encrypted network password (never plaintext, never a
    // hash — the chatbot must be able to decrypt it for authorized users).
    passwordCiphertext: { type: String, select: false },
    completedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" },
);
rotationEventSchema.index({ createdAt: -1 });
rotationEventSchema.index({ status: 1, createdAt: -1 });
// At most one rotation in progress at a time, across processes.
rotationEventSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" }, name: "one_pending_rotation" },
);

const passwordRequestSchema = new Schema(
  {
    // Absent for unauthenticated attempts (PRD §7 Flow D still logs them).
    user: { type: Schema.Types.ObjectId, ref: "User" },
    granted: { type: Boolean, required: true },
    denialReason: { type: String, enum: DENIAL_REASONS },
    sourceIp: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" },
);
// Supports the sliding-window rate limit and per-user anomaly checks.
passwordRequestSchema.index({ user: 1, createdAt: -1 });
passwordRequestSchema.index({ createdAt: -1 });

export const ROTATION_SETTINGS_ID = "global";

// Singleton document (_id = "global").
const rotationSettingsSchema = new Schema(
  {
    _id: { type: String, default: ROTATION_SETTINGS_ID },
    enabled: { type: Boolean, required: true, default: true },
    intervalValue: { type: Number, required: true, default: 7, min: 1 },
    intervalUnit: { type: String, enum: INTERVAL_UNITS, required: true, default: "DAYS" },
    // Minutes after midnight in `timezone`; no window = rotate any time.
    windowStartMinute: { type: Number, min: 0, max: 1439 },
    windowEndMinute: { type: Number, min: 0, max: 1439 },
    timezone: { type: String, required: true, default: "UTC" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  // optimisticConcurrency guards settings edits racing a rotation (Phase 5).
  { timestamps: true, strict: "throw", optimisticConcurrency: true },
);

const auditLogSchema = new Schema(
  {
    // Absent when the actor is the system (e.g. scheduled rotation).
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    target: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" },
);
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const User = model("User", userSchema, "users");
export const RotationEvent = model("RotationEvent", rotationEventSchema, "rotation_events");
export const PasswordRequest = model("PasswordRequest", passwordRequestSchema, "password_requests");
export const RotationSettings = model(
  "RotationSettings",
  rotationSettingsSchema,
  "rotation_settings",
);
export const AuditLog = model("AuditLog", auditLogSchema, "audit_log");

export const allModels = [User, RotationEvent, PasswordRequest, RotationSettings, AuditLog];
