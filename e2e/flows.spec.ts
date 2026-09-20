// PRD §7 flows A–E through the real UI.
import { expect, test, type Page } from "@playwright/test";

import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../scripts/demo-seed";

async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the session cookie: the next navigation must not bounce back here.
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("Flow A — an admin configures rotation", () => {
  test("changes the schedule and sees it saved", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.admin);
    await expect(page).toHaveURL("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("link", { name: "Rotation" }).click();
    await expect(page).toHaveURL("/admin/rotation");
    await page.getByLabel("Interval", { exact: true }).fill("3");
    await page.getByLabel("Interval unit").selectOption("DAYS");
    await page.getByLabel("Only rotate during a time window").check();
    await page.getByLabel("Window start").fill("02:00");
    await page.getByLabel("Window end").fill("05:00");
    await page.getByRole("button", { name: /Save/ }).click();

    await expect(page.getByText("Settings saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Interval", { exact: true })).toHaveValue("3");
    await expect(page.getByLabel("Window start")).toHaveValue("02:00");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByText("Every 3 days, between 02:00 and 05:00 (UTC)")).toBeVisible();
  });
});

test.describe("Flow B — rotation", () => {
  test("rotate now creates a new password and history entry", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.admin);
    await page.goto("/admin/rotation");
    const rowsBefore = await page.getByRole("row").count();

    await page.getByRole("button", { name: "Rotate now" }).first().click();
    await page.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(page.getByText(/Password rotated|New password created/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("row")).toHaveCount(rowsBefore + 1);
    const newest = page.getByRole("row").nth(1);
    await expect(newest).toContainText("Manual");
    await expect(newest).toContainText("Succeeded");
    await expect(newest).toContainText("Applied to the virtual router");
    await expect(newest).toContainText(DEMO_ACCOUNTS.admin);
  });

  test("an admin can reveal the current password, and it is logged", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.admin);
    await page.getByRole("button", { name: "Reveal current password" }).click();
    await page.getByRole("button", { name: "Reveal", exact: true }).click();

    const shown = page.locator("code").first();
    await expect(shown).toBeVisible();
    expect((await shown.textContent())?.trim().length).toBeGreaterThanOrEqual(12);
    await expect(page.getByText(/Hides automatically in/)).toBeVisible();
  });
});

test.describe("Flow C — a user gets the password from the assistant", () => {
  test("the password appears in its own panel and hides again", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.user);
    await expect(page).toHaveURL("/chat");

    // The model isn't called in tests; the server's reply shape is fixed here.
    // What the password gate itself does is covered by the integration tests.
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "Here's the current Wi-Fi password.",
          reveal: { password: "Demo-Passw0rd-42", rotatedAt: new Date().toISOString() },
        }),
      }),
    );

    await page.getByRole("button", { name: "What's the Wi-Fi password?" }).click();
    await expect(page.getByText("Here's the current Wi-Fi password.")).toBeVisible();
    await expect(page.getByText("Demo-Passw0rd-42")).toBeVisible();
    await expect(page.getByText(/don't share it/i)).toBeVisible();

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(page.getByText("Demo-Passw0rd-42")).toBeHidden();
    await expect(page.getByText(/each request is logged/i)).toBeVisible();
  });
});

test.describe("Flow D — someone without access asks", () => {
  test("gets an explanation and a way to request access, and is logged", async ({ page }) => {
    await page.goto("/chat");
    await page.getByLabel("Message").fill("What is the wifi password?");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/only give the Wi-Fi password to people signed in/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Request access" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in" }).first().click();
    await expect(page).toHaveURL(/\/login/);

    // The attempt shows up in the admin's request log.
    await signIn(page, DEMO_ACCOUNTS.admin);
    await page.goto("/admin/requests?show=denied");
    await expect(page.getByText("Not signed in").first()).toBeVisible();
  });

  test("a regular user cannot reach the admin app", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.user);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/\?denied=admin/);
    await expect(page.getByText("That page is only for administrators.")).toBeVisible();
  });
});

test.describe("Flow E — suspected leak: the admin revokes access", () => {
  test("the revoked person is locked out on their next page load", async ({ browser }) => {
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await signIn(userPage, DEMO_ACCOUNTS.otherUser);
    await expect(userPage).toHaveURL("/chat");

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await signIn(adminPage, DEMO_ACCOUNTS.admin);
    await adminPage.goto("/admin/users");
    const row = adminPage.getByRole("row").filter({ hasText: DEMO_ACCOUNTS.otherUser });
    await expect(row).toContainText("Active");
    await row.getByRole("button", { name: "Revoke" }).click();
    await adminPage.getByLabel("Reason (optional)").fill("Sharing the password");
    await adminPage.getByRole("button", { name: "Revoke", exact: true }).last().click();
    await expect(row).toContainText("Revoked");

    // The user's still-signed-in tab loses access immediately.
    await userPage.goto("/chat");
    await userPage.getByLabel("Message").fill("password please");
    await userPage.getByRole("button", { name: "Send" }).click();
    await expect(userPage.getByText(/revoked/i)).toBeVisible();

    // And the admin can put them back.
    await row.getByRole("button", { name: "Reinstate" }).click();
    await expect(row).toContainText("Active");

    await userContext.close();
    await adminContext.close();
  });

  test("the dashboard flags someone who asks unusually often", async ({ page }) => {
    await signIn(page, DEMO_ACCOUNTS.admin);
    await expect(page.getByText("Unusually many password requests")).toBeVisible();
    await expect(page.getByText(new RegExp(DEMO_ACCOUNTS.user))).toBeVisible();
    await expect(page.getByRole("link", { name: /alert/ })).toBeVisible();
  });
});
