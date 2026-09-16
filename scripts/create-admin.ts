// Creates an ACTIVE admin account, e.g. the first one.
//   npm run user:create-admin -- --email admin@example.com [--name "Jane Admin"]
// The password is read from a hidden prompt, or from NETGUARD_ADMIN_PASSWORD
// for non-interactive use. It is never accepted as a command-line argument,
// which would leave it in shell history.
import "dotenv/config";

import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import { bootstrapAdmin } from "@/features/auth/users";
import { disconnectDb } from "@/lib/db/connection";

function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as { _writeToOutput: (text: string) => void };
  let prompted = false;
  output._writeToOutput = (text) => {
    // Print the question once, then hide what is typed.
    if (!prompted) {
      process.stdout.write(text);
      prompted = true;
    }
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
  });
  if (!values.email) {
    console.error('Usage: npm run user:create-admin -- --email <email> [--name "<name>"]');
    process.exitCode = 1;
    return;
  }

  let password = process.env.NETGUARD_ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden("Password (min. 12 characters): ");
    if (password !== (await promptHidden("Repeat password: "))) {
      console.error("Passwords do not match.");
      process.exitCode = 1;
      return;
    }
  }

  const user = await bootstrapAdmin({ email: values.email, name: values.name, password });
  console.log(`Created admin ${user.email} (${user.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error("create-admin failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
