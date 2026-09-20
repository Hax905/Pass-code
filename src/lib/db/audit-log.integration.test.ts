import { clearTestDatabase } from "@/test/integration-db";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, AuditLogImmutableError } = await import("@/lib/db/models");

describe("audit log is append-only (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectDb();
  });

  it("accepts new entries", async () => {
    await AuditLog.create({ action: "test.one" });
    await AuditLog.create([{ action: "test.two" }, { action: "test.three" }]);
    await AuditLog.insertMany([{ action: "test.four" }]);
    await AuditLog.bulkWrite([{ insertOne: { document: { action: "test.five" } } }]);
    expect(await AuditLog.countDocuments()).toBe(5);
  });

  it("refuses every kind of update or delete", async () => {
    const entry = await AuditLog.create({ action: "user.revoked", target: "someone" });
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["updateOne", () => AuditLog.updateOne({ _id: entry._id }, { action: "nothing" })],
      ["updateMany", () => AuditLog.updateMany({}, { action: "nothing" })],
      ["replaceOne", () => AuditLog.replaceOne({ _id: entry._id }, { action: "nothing" })],
      ["findOneAndUpdate", () => AuditLog.findOneAndUpdate({}, { action: "nothing" })],
      ["findByIdAndUpdate", () => AuditLog.findByIdAndUpdate(entry._id, { action: "nothing" })],
      ["findOneAndReplace", () => AuditLog.findOneAndReplace({}, { action: "nothing" })],
      ["deleteOne", () => AuditLog.deleteOne({ _id: entry._id })],
      ["deleteMany", () => AuditLog.deleteMany({})],
      ["findOneAndDelete", () => AuditLog.findOneAndDelete({})],
      ["findByIdAndDelete", () => AuditLog.findByIdAndDelete(entry._id)],
      ["document.deleteOne", () => entry.deleteOne()],
      [
        "document.save",
        async () => {
          entry.action = "nothing";
          await entry.save();
        },
      ],
      [
        "bulkWrite update",
        () =>
          AuditLog.bulkWrite([
            { updateOne: { filter: { _id: entry._id }, update: { action: "nothing" } } },
          ]),
      ],
      ["bulkWrite delete", () => AuditLog.bulkWrite([{ deleteMany: { filter: {} } }])],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toBeInstanceOf(AuditLogImmutableError);
    }

    const stored = await AuditLog.findById(entry._id).lean();
    expect(stored).toMatchObject({ action: "user.revoked", target: "someone" });
    expect(await AuditLog.countDocuments()).toBe(1);
  });
});
