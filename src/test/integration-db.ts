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
