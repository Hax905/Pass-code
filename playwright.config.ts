import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build on its own database
// (passcode_e2e_test), seeded by e2e/global-setup.ts. The scheduler stays off
// so background rotations can't change what a test is looking at.
const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_NAME: "passcode_e2e_test",
      ROTATION_SCHEDULER_ENABLED: "false",
      AUTH_URL: baseURL,
    },
  },
});
