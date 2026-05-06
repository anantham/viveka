import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Viveka e2e tests.
 *
 * Tests target a running dev server at PLAYWRIGHT_BASE_URL (default
 * http://localhost:3000). Tests assume an existing workspace exists
 * with id PLAYWRIGHT_WORKSPACE_ID — set this to a real workspace from
 * .viveka-data/workspaces.json before running. (A future improvement
 * is a `globalSetup` that creates a fresh fixture workspace per run.)
 *
 * Run: npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // many tests share workspace state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // serialize to avoid stomping on workspace state
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Don't auto-start the dev server — user runs it manually so they
  // can see what tests are doing live. CI should set up its own.
});
