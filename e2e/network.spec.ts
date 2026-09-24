// Joining the virtual Wi-Fi, and a rotation dropping every device off it.
import { expect, test, type Page } from "@playwright/test";

import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../scripts/demo-seed";

async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Reads the current network password out of the admin's reveal panel. */
async function revealPassword(page: Page): Promise<string> {
  await page.goto("/admin");
  await page.getByRole("button", { name: "Reveal current password" }).click();
  await page.getByRole("button", { name: "Reveal", exact: true }).click();
  const shown = page.locator("code").first();
  await expect(shown).toBeVisible();
  const password = (await shown.textContent())?.trim();
  if (!password) throw new Error("no password was revealed");
  return password;
}

async function connect(page: Page, deviceName: string, password: string) {
  await page.goto("/network");
  await page.getByLabel("Device").fill(deviceName);
  await page.getByLabel("Network password").fill(password);
  await page.getByRole("button", { name: "Connect" }).click();
}

test.describe("the virtual Wi-Fi", () => {
  test("connects with the current password and refuses a wrong one", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.admin);
    const password = await revealPassword(page);

    await connect(page, "Wrong guess", "definitely-not-the-password");
    await expect(page.getByText(/isn't the current network password/)).toBeVisible();

    await connect(page, "Demo laptop", password);
    const device = page.getByRole("listitem").filter({ hasText: "Demo laptop" });
    await expect(device.getByText("Online")).toBeVisible();
    await expect(page.getByText("On the network", { exact: true })).toBeVisible();
  });

  test("a rotation drops the device while the page is open, and it can rejoin", async ({
    page,
  }) => {
    await signIn(page, DEMO_ACCOUNTS.admin);
    const password = await revealPassword(page);
    await connect(page, "Demo phone", password);
    const device = page.getByRole("listitem").filter({ hasText: "Demo phone" });
    await expect(device.getByText("Online")).toBeVisible();

    // The admin sees it on the network.
    const admin = await page.context().newPage();
    await admin.goto("/admin");
    await expect(admin.getByText("Demo phone")).toBeVisible();

    // Rotate from the admin page while the network page stays open and untouched.
    await admin.getByRole("button", { name: "Rotate now" }).first().click();
    await admin.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(admin.getByText(/Password rotated|New password created/)).toBeVisible();

    // The admin's list of connected devices empties out…
    await admin.reload();
    await expect(admin.getByText("Nothing is connected right now.")).toBeVisible();
    await expect(admin.getByText(/dropped by the latest rotation/)).toBeVisible();

    // …and the still-open network page notices by itself, with no reload: this
    // is what a person on the Wi-Fi experiences when the password changes.
    await expect(device.getByText("Dropped by rotation")).toBeVisible();
    await expect(page.getByText(/Demo phone was disconnected/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask the assistant" })).toBeVisible();

    // The old password no longer works; the new one does.
    await connect(page, "Demo phone", password);
    await expect(page.getByText(/isn't the current network password/)).toBeVisible();

    const rotated = await revealPassword(admin);
    expect(rotated).not.toBe(password);
    await connect(page, "Demo phone", rotated);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo phone" }).getByText("Online"),
    ).toBeVisible();
    await admin.close();
  });

  test("a visitor with no account can join, and the admin sees it flagged", async ({ browser }) => {
    // Its own browser context: no session cookie at all.
    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    const admin = await browser.newPage();
    await signIn(admin, DEMO_ACCOUNTS.admin);
    const password = await revealPassword(admin);

    await connect(visitorPage, "Guest phone", password);
    await expect(
      visitorPage.getByRole("listitem").filter({ hasText: "Guest phone" }).getByText("Online"),
    ).toBeVisible();

    // The point of the demo: the password reached someone with no account, and
    // the dashboard says so by name.
    await admin.goto("/admin");
    const flagged = admin.getByRole("listitem").filter({ hasText: "Guest phone" });
    await expect(flagged.getByText("No account")).toBeVisible();

    await visitor.close();
    await admin.close();
  });
});
