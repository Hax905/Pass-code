// PassCode data model — see STYLES.md §2.3 (pivoted to MongoDB, see TASKLIST.md Phase 0 log).
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
export const CONNECTION_STATUSES = ["CONNECTED", "DISCONNECTED"] as const;
export const DISCONNECT_REASONS = ["BY_USER", "PASSWORD_CHANGED"] as const;

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
    // Bumped inside every password request's transaction, so two requests for
    // the same user conflict and run one after the other (exact rate limit).
    passwordRequestSeq: { type: Number, min: 0 },
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

// A device "joined the Wi-Fi" of the virtual router. This models association
// only: the RouterAdapter boundary stays a single applyPassword call, because a
// real router adapter must never grow client-management powers (PRD §4).
const networkConnectionSchema = new Schema(
  {
    deviceName: { type: String, required: true, trim: true, maxlength: 40 },
    // Absent for a device that joined with no account — the informal sharing
    // this project exists to make visible.
    user: { type: Schema.Types.ObjectId, ref: "User" },
    // Opaque per-browser token (httpOnly cookie), so a signed-out visitor can
    // still see and disconnect the devices it joined with.
    client: { type: String, required: true },
    // The rotation whose password this device joined with. A device counts as
    // on the network only while this is still the newest successful rotation,
    // which is how a rotation drops everyone without writing to any row here.
    rotationEvent: { type: Schema.Types.ObjectId, ref: "RotationEvent", required: true },
    status: { type: String, enum: CONNECTION_STATUSES, required: true, default: "CONNECTED" },
    disconnectedAt: { type: Date },
    disconnectReason: { type: String, enum: DISCONNECT_REASONS },
    sourceIp: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" },
);
// "My devices" on the user page.
networkConnectionSchema.index({ client: 1, createdAt: -1 });
// The admin panel's "who is on the network right now".
networkConnectionSchema.index({ status: 1, rotationEvent: 1, createdAt: -1 });
// One live row per device name per browser per password generation, so a double
// submit can't connect the same device twice. It includes rotationEvent so that
// reconnecting after a rotation is a new row rather than a conflict.
networkConnectionSchema.index(
  { client: 1, deviceName: 1, rotationEvent: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "CONNECTED" },
    name: "one_live_connection_per_device",
  },
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
// Failed-login throttling looks up recent failures per email.
auditLogSchema.index({ action: 1, target: 1, createdAt: -1 });

export class AuditLogImmutableError extends Error {
  constructor() {
    super("The audit log is append-only: entries can't be changed or deleted");
    this.name = "AuditLogImmutableError";
  }
}

// Append-only (PRD §8). Blocks every update and delete that goes through
// Mongoose; inserts are the only allowed write. Tests clear the collection
// through the raw driver (`AuditLog.collection`), which a production code path
// never does.
function refuseChange() {
  throw new AuditLogImmutableError();
}
for (const op of [
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  auditLogSchema.pre(op, { document: true, query: true }, refuseChange);
}
auditLogSchema.pre("save", function () {
  if (!this.isNew) refuseChange();
});
auditLogSchema.pre("bulkWrite", function (ops) {
  if (ops.some((op) => !("insertOne" in op))) refuseChange();
});

export const User = model("User", userSchema, "users");
export const RotationEvent = model("RotationEvent", rotationEventSchema, "rotation_events");
export const PasswordRequest = model("PasswordRequest", passwordRequestSchema, "password_requests");
export const RotationSettings = model(
  "RotationSettings",
  rotationSettingsSchema,
  "rotation_settings",
);
export const NetworkConnection = model(
  "NetworkConnection",
  networkConnectionSchema,
  "network_connections",
);
export const AuditLog = model("AuditLog", auditLogSchema, "audit_log");

export const allModels = [
  User,
  RotationEvent,
  PasswordRequest,
  RotationSettings,
  NetworkConnection,
  AuditLog,
];
