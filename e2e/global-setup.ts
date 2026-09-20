import "dotenv/config";

import { disconnectDb } from "@/lib/db/connection";

// Same demo data the `npm run demo:seed` command creates, in its own database.
export default async function globalSetup() {
  process.env.DATABASE_NAME = "passcode_e2e_test";
  const { seedDemoData } = await import("../scripts/demo-seed");
  const { database } = await seedDemoData();
  if (database !== "passcode_e2e_test") throw new Error(`seeded the wrong database: ${database}`);
  await disconnectDb();
}
