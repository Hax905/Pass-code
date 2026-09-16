// Manual "rotate now" without a UI (PRD §6.1).
//   npm run rotate
// Prints the outcome but never the password.
import "dotenv/config";

import { disconnectDb } from "@/lib/db/connection";
import { rotateNetworkPassword } from "@/features/rotation/rotation-service";

async function main() {
  const result = await rotateNetworkPassword({ trigger: "MANUAL", source: "cli" });
  if (result.status === "SUCCEEDED") {
    console.log(`Rotation ${result.eventId} succeeded (attempts: ${result.attempts}).`);
    if (result.manualApplicationRequired) {
      console.log("The router was not changed automatically: apply the new password on it.");
    }
  } else {
    console.error(
      `Rotation ${result.eventId} FAILED after ${result.attempts} attempts: ${result.errorMessage}`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("rotate failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
