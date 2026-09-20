import { clearTestDatabase, TEST_DATABASE_NAME } from "@/test/integration-db";

import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, User } = await import("@/lib/db/models");

describe("database (integration)", () => {
  beforeAll(async () => {
    await connectDb();
    for (const model of allModels) {
      await model.collection.deleteMany({});
      await model.createCollection();
      await model.syncIndexes();
    }
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectDb();
  });

  it("connects to the isolated test database", async () => {
    const { connection } = await connectDb();
    expect(connection.name).toBe(TEST_DATABASE_NAME);
    const ping = await connection.db!.admin().ping();
    expect(ping.ok).toBe(1);
  });

  it("enforces unique user emails", async () => {
    await User.create({ email: "dup@example.com" });
    await expect(User.create({ email: "DUP@example.com" })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("does not return the password hash unless explicitly selected", async () => {
    await User.create({ email: "hash@example.com", passwordHash: "not-a-real-hash" });
    const plain = await User.findOne({ email: "hash@example.com" }).lean();
    expect(plain).not.toHaveProperty("passwordHash");
    const withHash = await User.findOne({ email: "hash@example.com" })
      .select("+passwordHash")
      .lean();
    expect(withHash?.passwordHash).toBe("not-a-real-hash");
  });

  // Later phases rely on multi-document transactions (e.g. revoke user + audit
  // entry, rotation event + stored password), which need a replica set.
  it("supports multi-document transactions", async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const [user] = await User.create([{ email: "txn@example.com" }], { session });
        await AuditLog.create([{ actor: user._id, action: "test.transaction" }], { session });
      });
    } finally {
      await session.endSession();
    }
    expect(await AuditLog.countDocuments({ action: "test.transaction" })).toBe(1);
  });
});
