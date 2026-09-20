// Integration tests delete everything in their database, so they only ever run
// against one whose name ends in "_test" (default: passcode_test).
// Import this before anything that connects to MongoDB.
import "dotenv/config";

const name = process.env.TEST_DATABASE_NAME ?? "passcode_test";
if (!name.endsWith("_test")) {
  throw new Error(
    `Refusing to run integration tests against "${name}": the name must end in _test`,
  );
}
process.env.DATABASE_NAME = name;

export const TEST_DATABASE_NAME = name;

/**
 * Empties every collection. Goes through the raw driver because the audit log
 * refuses deletes through Mongoose (it's append-only).
 */
export async function clearTestDatabase() {
  const [{ default: mongoose }, { allModels }] = await Promise.all([
    import("mongoose"),
    import("@/lib/db/models"),
  ]);
  if (mongoose.connection.name !== name) {
    throw new Error(`Refusing to clear "${mongoose.connection.name}"`);
  }
  for (const model of allModels) await model.collection.deleteMany({});
}
