import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "@playwright/test";

const authDir = path.resolve("playwright-output/auth");
const storageStatePath = path.join(authDir, "storage-state.json");

async function main() {
  await fs.mkdir(authDir, { recursive: true });

  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("[pw:auth] Opening Mathcha in a headed browser.");
  console.log("[pw:auth] Optional step: sign in manually if you want authenticated analysis later.");
  await page.goto("https://www.mathcha.io/editor", { waitUntil: "domcontentloaded" });

  const rl = readline.createInterface({ input, output });
  try {
    await rl.question("[pw:auth] Press Enter after the session is ready to save storage state...");
    await context.storageState({ path: storageStatePath });
    console.log(`[pw:auth] Saved storage state to ${storageStatePath}`);
  } finally {
    rl.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[pw:auth] Failed to capture auth state");
  console.error(error);
  process.exitCode = 1;
});
