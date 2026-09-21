// Dark mode: the toggle, what it remembers, and what it does before first paint.
import { expect, test, type Page } from "@playwright/test";

import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../scripts/demo-seed";

const toggle = (page: Page) => page.getByRole("button", { name: /light and dark/i });
const isDark = (page: Page) => page.locator("html").evaluate((el) => el.classList.contains("dark"));

test.describe("Dark mode", () => {
  test.use({ colorScheme: "light" });

  test("can be turned on, and is still on after a reload", async ({ page }) => {
    await page.goto("/chat");
    expect(await isDark(page)).toBe(false);

    await toggle(page).click();
    expect(await isDark(page)).toBe(true);

    // The choice lives in localStorage, and the inline script has to re-apply
    // it while the document is parsing — otherwise the page flashes white.
    await page.reload();
    expect(await isDark(page)).toBe(true);

    await toggle(page).click();
    await page.reload();
    expect(await isDark(page)).toBe(false);
  });

  test("the choice carries across the user and admin sides", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO_ACCOUNTS.admin);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);

    // Set on the sign-in page, before a session even exists.
    await toggle(page).click();
    expect(await isDark(page)).toBe(true);

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/admin");
    expect(await isDark(page)).toBe(true);

    for (const path of ["/admin/rotation", "/admin/users", "/admin/requests", "/chat"]) {
      await page.goto(path);
      expect(await isDark(page), `${path} should still be dark`).toBe(true);
    }
  });
});

test.describe("Dark mode without a stored choice", () => {
  test.use({ colorScheme: "dark" });

  test("follows the operating system", async ({ page }) => {
    await page.goto("/");
    expect(await isDark(page)).toBe(true);
  });
});
