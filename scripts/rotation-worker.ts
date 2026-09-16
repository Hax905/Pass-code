// Standalone rotation scheduler, for hosts where the Next.js server isn't a
// long-running process (e.g. serverless).
//   npm run rotation:worker
import "dotenv/config";

import cron from "node-cron";

import { disconnectDb } from "@/lib/db/connection";
import { startRotationScheduler } from "@/features/rotation/scheduler";
import { getRotationEnv } from "@/lib/env";

getRotationEnv(); // fail fast on a missing/invalid encryption key
startRotationScheduler();
console.log("Rotation scheduler running. Press Ctrl+C to stop.");

async function stop() {
  await cron.shutdown();
  await disconnectDb();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
