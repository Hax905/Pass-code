import { clearTestDatabase } from "@/test/integration-db";

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Tests supply their own key; the real one is never needed.
const encryptionKey = randomBytes(32);
process.env.PASSCODE_ENCRYPTION_KEY = encryptionKey.toString("base64");

const { connectDb, disconnectDb } = await import("@/lib/db/connection");
const { allModels, AuditLog, NetworkConnection, User } = await import("@/lib/db/models");
const { MockRouterAdapter } = await import("@/features/rotation/mock-router-adapter");
const { getCurrentNetworkPassword, rotateNetworkPassword } =
  await import("@/features/rotation/rotation-service");
const { connectDevice, disconnectDevice, getNetworkStateForClient, listConnectedDevices } =
  await import("./virtual-network");
const { clientConnectLimiter, ipConnectLimiter } = await import("./rate-limit");

/** Rotates and returns the new password, so a test can join the network with it. */
async function rotateAndGetPassword(): Promise<string> {
  const result = await rotateNetworkPassword({
    trigger: "MANUAL",
    source: "test",
    adapter: new MockRouterAdapter(),
  });
  expect(result.status).toBe("SUCCEEDED");
  const current = await getCurrentNetworkPassword(encryptionKey);
  return current!.password;
}

// The limiters are in-memory and shared across a test file, so every test uses
// its own browser/IP identity and doesn't inherit another's count.
function freshClient() {
  return { client: randomUUID(), ip: `10.0.0.${Math.floor(Math.random() * 250) + 1}` };
}

describe("virtual network (integration)", () => {
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

  it("joins the network with the current password and logs it", async () => {
    const password = await rotateAndGetPassword();
    const who = freshClient();

    const result = await connectDevice({ deviceName: "My phone", password, ...who });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a connection");
    expect(result.device).toMatchObject({
      deviceName: "My phone",
      online: true,
      droppedByRotation: false,
    });

    const entry = await AuditLog.findOne({ action: "network.connected" }).lean();
    expect(entry?.metadata).toMatchObject({ deviceName: "My phone", withAccount: false });
  });

  it("refuses the wrong password, logs the attempt, and connects nothing", async () => {
    await rotateAndGetPassword();
    const who = freshClient();

    const result = await connectDevice({ deviceName: "Laptop", password: "not-it", ...who });

    expect(result).toEqual({ ok: false, reason: "WRONG_PASSWORD" });
    expect(await NetworkConnection.countDocuments({})).toBe(0);
    const entry = await AuditLog.findOne({ action: "network.connect_denied" }).lean();
    expect(entry?.metadata).toMatchObject({ deviceName: "Laptop", reason: "WRONG_PASSWORD" });
  });

  it("refuses the previous password after a rotation", async () => {
    const oldPassword = await rotateAndGetPassword();
    await rotateAndGetPassword();
    const who = freshClient();

    expect(await connectDevice({ deviceName: "Laptop", password: oldPassword, ...who })).toEqual({
      ok: false,
      reason: "WRONG_PASSWORD",
    });
  });

  it("refuses to connect before any password exists", async () => {
    const who = freshClient();
    expect(await connectDevice({ deviceName: "Laptop", password: "anything", ...who })).toEqual({
      ok: false,
      reason: "NO_PASSWORD",
    });
  });

  it("drops every connected device when the password rotates, without writing to their rows", async () => {
    const password = await rotateAndGetPassword();
    const alice = freshClient();
    const bob = freshClient();
    await connectDevice({ deviceName: "Phone", password, ...alice });
    await connectDevice({ deviceName: "Laptop", password, ...alice });
    await connectDevice({ deviceName: "Tablet", password, ...bob });
    expect((await listConnectedDevices()).online).toHaveLength(3);

    const before = await NetworkConnection.find({}).sort({ createdAt: 1 }).lean();
    await rotateAndGetPassword();

    // Nobody is on the network any more…
    const after = await listConnectedDevices();
    expect(after.online).toHaveLength(0);
    expect(after.droppedByLastRotation).toBe(3);

    // …and the rotation didn't touch a single connection row to do it: the rows
    // are unchanged, it's the current password generation that moved.
    const unchanged = await NetworkConnection.find({}).sort({ createdAt: 1 }).lean();
    expect(unchanged).toEqual(before);

    // Each owner sees their own devices dropped, with the reason.
    const view = await getNetworkStateForClient(alice.client);
    expect(view.devices).toHaveLength(2);
    expect(view.devices.every((d) => d.droppedByRotation && !d.online)).toBe(true);
    expect(view.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("lets a dropped device rejoin with the new password", async () => {
    const first = await rotateAndGetPassword();
    const who = freshClient();
    await connectDevice({ deviceName: "My phone", password: first, ...who });

    const second = await rotateAndGetPassword();
    const rejoined = await connectDevice({ deviceName: "My phone", password: second, ...who });

    expect(rejoined).toMatchObject({ ok: true });
    const view = await getNetworkStateForClient(who.client);
    // One live row, and the stale one closed out as PASSWORD_CHANGED rather
    // than left looking connected.
    expect(view.devices.filter((d) => d.online)).toHaveLength(1);
    expect(view.devices.filter((d) => d.droppedByRotation)).toHaveLength(0);
    const closed = await NetworkConnection.findOne({ disconnectReason: "PASSWORD_CHANGED" }).lean();
    expect(closed?.status).toBe("DISCONNECTED");
  });

  it("won't connect the same device twice on one password", async () => {
    const password = await rotateAndGetPassword();
    const who = freshClient();
    await connectDevice({ deviceName: "My phone", password, ...who });

    expect(await connectDevice({ deviceName: "My phone", password, ...who })).toEqual({
      ok: false,
      reason: "ALREADY_CONNECTED",
    });
    expect(await NetworkConnection.countDocuments({ status: "CONNECTED" })).toBe(1);
  });

  it("attributes a device to its account, and flags one with no account", async () => {
    const password = await rotateAndGetPassword();
    const user = await User.create({
      email: `resident-${randomUUID()}@example.com`,
      role: "USER",
      status: "ACTIVE",
    });

    await connectDevice({
      deviceName: "Resident phone",
      password,
      ...freshClient(),
      userId: user._id.toString(),
    });
    await connectDevice({ deviceName: "Unknown laptop", password, ...freshClient() });

    const { online } = await listConnectedDevices();
    expect(online).toHaveLength(2);
    expect(online.find((d) => d.deviceName === "Resident phone")?.email).toBe(user.email);
    // The password reached someone with no account: the informal sharing this
    // project exists to make visible.
    expect(online.find((d) => d.deviceName === "Unknown laptop")?.email).toBeNull();
  });

  it("disconnects by choice, and only the browser that joined can do it", async () => {
    const password = await rotateAndGetPassword();
    const owner = freshClient();
    const stranger = freshClient();
    const joined = await connectDevice({ deviceName: "My phone", password, ...owner });
    if (!joined.ok) throw new Error("expected a connection");

    // Someone else's browser can't disconnect it.
    expect(
      await disconnectDevice({ client: stranger.client, connectionId: joined.device.id }),
    ).toEqual({ ok: false });
    expect(await NetworkConnection.countDocuments({ status: "CONNECTED" })).toBe(1);

    expect(
      await disconnectDevice({ client: owner.client, connectionId: joined.device.id }),
    ).toEqual({ ok: true });
    const view = await getNetworkStateForClient(owner.client);
    expect(view.devices[0]).toMatchObject({ online: false, droppedByRotation: false });
    expect(await AuditLog.countDocuments({ action: "network.disconnected" })).toBe(1);
  });

  it("ignores a malformed device id instead of throwing", async () => {
    expect(await disconnectDevice({ client: "anyone", connectionId: "not-an-id" })).toEqual({
      ok: false,
    });
  });

  it("rate-limits connect attempts per browser, and says when to retry", async () => {
    await rotateAndGetPassword();
    const who = freshClient();

    // Wrong guesses, so nothing is ever actually connected.
    const attempts = [];
    for (let i = 0; i < clientConnectLimiter.max + 1; i++) {
      attempts.push(
        await connectDevice({ deviceName: `Guess ${i}`, password: `wrong-${i}`, ...who }),
      );
    }

    expect(attempts.slice(0, clientConnectLimiter.max).every((r) => !r.ok)).toBe(true);
    const last = attempts.at(-1)!;
    expect(last.ok).toBe(false);
    if (last.ok) throw new Error("expected a refusal");
    expect(last.reason).toBe("RATE_LIMITED");
    if (last.reason !== "RATE_LIMITED") throw new Error("expected a rate limit");
    expect(last.retryAt).toBeInstanceOf(Date);

    // Refused before the database is read at all: no extra audit rows beyond
    // the attempts that were actually evaluated.
    expect(await AuditLog.countDocuments({ action: "network.connect_denied" })).toBe(
      clientConnectLimiter.max,
    );
  });

  it("rate-limits per IP even across different browsers", async () => {
    await rotateAndGetPassword();
    const ip = "203.0.113.9";
    let refusals = 0;
    for (let i = 0; i < ipConnectLimiter.max + 1; i++) {
      const result = await connectDevice({
        deviceName: "Device",
        password: `wrong-${i}`,
        client: randomUUID(), // a new browser every time
        ip,
      });
      if (!result.ok && result.reason === "RATE_LIMITED") refusals++;
    }
    expect(refusals).toBe(1);
  });

  it("tells a browser that has never connected nothing about the password", async () => {
    await rotateAndGetPassword();
    const view = await getNetworkStateForClient(randomUUID());

    expect(view.devices).toEqual([]);
    expect(view.networkReady).toBe(true);
    // When the password last changed is withheld from a browser that has never
    // held it — it only ever reaches a device that actually joined.
    expect(view.passwordChangedAt).toBeNull();
  });
});
