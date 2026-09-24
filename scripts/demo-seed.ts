// Fills a database with demo accounts and activity, for showing PassCode or
// running the end-to-end tests.
//   npm run demo:seed
// Refuses to touch a database whose name doesn't end in _demo or _test unless
// you pass --force, because it deletes everything first.
import "dotenv/config";

import { parseArgs } from "node:util";

import { connectDevice } from "@/features/network/virtual-network";
import { MockRouterAdapter } from "@/features/rotation/mock-router-adapter";
import {
  getCurrentNetworkPassword,
  rotateNetworkPassword,
} from "@/features/rotation/rotation-service";
import { saveRotationSettings } from "@/features/rotation/settings";
import * as users from "@/features/auth/users";
import type { AuthorizedUser } from "@/features/auth/types";
import { connectDb, disconnectDb } from "@/lib/db/connection";
import { allModels, PasswordRequest } from "@/lib/db/models";

export const DEMO_PASSWORD = "passcode demo 2026";
export const DEMO_ACCOUNTS = {
  admin: "admin@passcode.demo",
  secondAdmin: "diego@passcode.demo",
  user: "maria@passcode.demo",
  otherUser: "carlos@passcode.demo",
  revoked: "former@passcode.demo",
  pending: "newcomer@passcode.demo",
} as const;

const HOUR = 60 * 60 * 1000;

export async function seedDemoData() {
  const { connection } = await connectDb();
  for (const model of allModels) {
    await model.createCollection();
    await model.syncIndexes();
    await model.collection.deleteMany({});
  }

  const created = await users.bootstrapAdmin({
    email: DEMO_ACCOUNTS.admin,
    name: "Ana Admin",
    password: DEMO_PASSWORD,
  });
  const admin: AuthorizedUser = {
    id: created.id,
    email: created.email,
    name: "Ana Admin",
    role: "ADMIN",
    tokenVersion: 0,
  };
  const provision = (email: string, name: string, role: "ADMIN" | "USER" = "USER") =>
    users.provisionUser(admin, { email, name, password: DEMO_PASSWORD, role });

  await provision(DEMO_ACCOUNTS.secondAdmin, "Diego Admin", "ADMIN");
  const maria = await provision(DEMO_ACCOUNTS.user, "María Rojas");
  const carlos = await provision(DEMO_ACCOUNTS.otherUser, "Carlos Vega");
  const former = await provision(DEMO_ACCOUNTS.revoked, "Former Tenant");
  await users.revokeUser(admin, former.id, "Moved out");
  await users.registerUser({
    email: DEMO_ACCOUNTS.pending,
    name: "New Tenant",
    password: DEMO_PASSWORD,
  });

  await saveRotationSettings(
    admin,
    {
      enabled: true,
      intervalValue: 7,
      intervalUnit: "DAYS",
      windowStartMinute: null,
      windowEndMinute: null,
      timezone: "UTC",
    },
    null,
  );

  // One failed rotation, then a successful one, so the history isn't empty.
  await rotateNetworkPassword({
    trigger: "SCHEDULED",
    source: "demo-seed",
    adapter: new MockRouterAdapter({ alwaysFail: true }),
    retryDelayMs: 0,
  });
  await rotateNetworkPassword({
    trigger: "MANUAL",
    triggeredBy: admin.id,
    source: "demo-seed",
    adapter: new MockRouterAdapter(),
  });

  const now = Date.now();
  await PasswordRequest.insertMany([
    ...Array.from({ length: 6 }, (_, i) => ({
      user: maria.id,
      granted: true,
      sourceIp: "10.0.0.12",
      createdAt: new Date(now - i * HOUR),
    })),
    { user: carlos.id, granted: true, sourceIp: "10.0.0.20", createdAt: new Date(now - 3 * HOUR) },
    {
      user: former.id,
      granted: false,
      denialReason: "REVOKED",
      sourceIp: "10.0.0.31",
      createdAt: new Date(now - 2 * HOUR),
    },
    {
      granted: false,
      denialReason: "UNAUTHENTICATED",
      sourceIp: "10.0.0.99",
      createdAt: new Date(now - HOUR / 2),
    },
  ]);

  // Devices already on the virtual Wi-Fi, so the network doesn't start empty.
  // Connected through the real code path with the real current password, which
  // means a rotation drops all of them exactly as it would in a live demo.
  const current = await getCurrentNetworkPassword();
  if (current) {
    const devices = [
      { deviceName: "María's phone", userId: maria.id, client: "d1".repeat(16), ip: "10.0.0.12" },
      { deviceName: "María's laptop", userId: maria.id, client: "d2".repeat(16), ip: "10.0.0.13" },
      {
        deviceName: "Carlos's tablet",
        userId: carlos.id,
        client: "d3".repeat(16),
        ip: "10.0.0.20",
      },
      // No account: someone who was given the password informally. This is the
      // problem PassCode exists to solve, sitting in plain sight on the
      // dashboard until the next rotation removes it.
      { deviceName: "Unknown laptop", client: "d4".repeat(16), ip: "10.0.0.99" },
    ];
    for (const device of devices) {
      await connectDevice({ ...device, password: current.password });
    }
  }

  return { database: connection.name };
}

async function main() {
  const { values } = parseArgs({ options: { force: { type: "boolean" } } });
  const name = process.env.DATABASE_NAME ?? "passcode";
  if (!/(_demo|_test)$/.test(name) && !values.force) {
    console.error(
      `Refusing to seed "${name}": it deletes everything first.\n` +
        `Use a database whose name ends in _demo (set DATABASE_NAME), or pass --force.`,
    );
    process.exitCode = 1;
    return;
  }

  const { database } = await seedDemoData();
  console.log(`Seeded demo data in "${database}".`);
  console.log(`Every account uses the password: ${DEMO_PASSWORD}`);
  for (const [role, email] of Object.entries(DEMO_ACCOUNTS)) console.log(`  ${role}: ${email}`);
}

// Only run when executed directly, so tests can import seedDemoData().
if (process.argv[1]?.includes("demo-seed")) {
  main()
    .catch((error: unknown) => {
      console.error("demo:seed failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => disconnectDb());
}
