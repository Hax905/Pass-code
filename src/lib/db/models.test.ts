import { describe, expect, it } from "vitest";

import { AuditLog, PasswordRequest, RotationEvent, RotationSettings, User } from "@/lib/db/models";

// Returns the validation errors keyed by path, or undefined if the document is valid.
async function validationErrors(doc: { validate(): Promise<void> }) {
  try {
    await doc.validate();
    return undefined;
  } catch (error) {
    return (error as { errors: Record<string, unknown> }).errors;
  }
}

// Pure schema validation — no database connection needed.
describe("data models", () => {
  it("defaults new users to PENDING, USER, token version 0", async () => {
    const user = new User({ email: "  Alice@Example.com " });
    expect(await validationErrors(user)).toBeUndefined();
    expect(user.email).toBe("alice@example.com");
    expect(user.role).toBe("USER");
    expect(user.status).toBe("PENDING");
    expect(user.tokenVersion).toBe(0);
  });

  it("rejects unknown roles and statuses", async () => {
    const errors = await validationErrors(
      new User({ email: "a@example.com", role: "SUPERUSER", status: "ENABLED" }),
    );
    expect(errors).toHaveProperty("role");
    expect(errors).toHaveProperty("status");
  });

  it("refuses fields that are not in the schema", () => {
    expect(() => new User({ email: "a@example.com", isAdmin: true })).toThrow(/isAdmin/);
  });

  it("never selects secrets by default", () => {
    expect(User.schema.path("passwordHash").options.select).toBe(false);
    expect(RotationEvent.schema.path("passwordCiphertext").options.select).toBe(false);
  });

  it("requires trigger and adapter on rotation events", async () => {
    const errors = await validationErrors(new RotationEvent({}));
    expect(errors).toHaveProperty("trigger");
    expect(errors).toHaveProperty("adapter");
  });

  it("allows anonymous denied password requests but requires granted", async () => {
    expect(
      await validationErrors(
        new PasswordRequest({ granted: false, denialReason: "UNAUTHENTICATED" }),
      ),
    ).toBeUndefined();
    expect(await validationErrors(new PasswordRequest({}))).toHaveProperty("granted");
  });

  it("keeps rotation settings as a bounded singleton", async () => {
    const settings = new RotationSettings({});
    expect(settings._id).toBe("global");
    expect(settings.intervalUnit).toBe("DAYS");
    const errors = await validationErrors(
      new RotationSettings({ intervalValue: 0, windowStartMinute: 1440 }),
    );
    expect(errors).toHaveProperty("intervalValue");
    expect(errors).toHaveProperty("windowStartMinute");
  });

  it("requires an action on audit entries", async () => {
    expect(await validationErrors(new AuditLog({}))).toHaveProperty("action");
  });

  it("indexes user email uniquely", () => {
    expect(User.schema.indexes()).toContainEqual([
      { email: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
