import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const authStatePath = path.resolve("playwright-output/auth/storage-state.json");

export default defineConfig({
  testDir: "./playwright",
  timeout: 120000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-output/html-report", open: "never" }]],
  outputDir: "playwright-output/test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "https://www.mathcha.io",
    headless: process.env.PW_HEADED === "1" ? false : undefined,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    storageState: existsSync(authStatePath) ? authStatePath : undefined
  }
});
