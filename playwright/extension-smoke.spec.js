import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, chromium } from "@playwright/test";
import { prepareMathchaPage } from "./support.mjs";

const extensionPath = path.resolve("dist/extension/chromium");
const consoleBundlePath = path.resolve("dist/mathcha-toolkit.console.js");

async function selectWelcomeMath(page) {
  const mathTextLocator = page.locator("text=Input your mathematics formula inline:");
  await expect(mathTextLocator.first()).toBeVisible({ timeout: 10000 });
  await mathTextLocator.first().click();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(300);
}

test("Chromium extension boots on Mathcha", async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mathcha-toolkit-extension-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const page = await context.newPage();
    await prepareMathchaPage(page, context);
    await page.waitForFunction(() => Boolean(window.__MATHCHA_TOOLKIT__), undefined, { timeout: 30000 });

    const toolkit = await page.evaluate(() => ({
      version: window.__MATHCHA_TOOLKIT__?.version ?? null,
      platform: window.__MATHCHA_TOOLKIT__?.platform ?? null,
      commandKeys: Object.keys(window.__MATHCHA_TOOLKIT__?.commands ?? {})
    }));

    expect(toolkit.platform).toBe("extension");
    expect(toolkit.commandKeys).toEqual(["copyLatex", "analyze", "symbolab", "answer", "pasteFromLatex"]);

    await page.keyboard.down("Control");
    await page.keyboard.down("Alt");
    await page.waitForSelector("text=Toolkit Shortcuts (Ctrl+Alt+Key)", { timeout: 10000 });
    await page.keyboard.up("Alt");
    await page.keyboard.up("Control");

    await selectWelcomeMath(page);
    await page.evaluate(async () => {
      await window.__MATHCHA_TOOLKIT__?.commands.copyLatex();
    });

    const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
    expect(clipboardText.length).toBeGreaterThan(0);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test("Console bundle boots on Mathcha", async ({ page }) => {
  const consoleBundle = await fs.readFile(consoleBundlePath, "utf8");
  await prepareMathchaPage(page, page.context());
  await page.addScriptTag({ content: consoleBundle });
  await page.waitForFunction(() => Boolean(window.__MATHCHA_TOOLKIT__), undefined, { timeout: 30000 });

  const toolkit = await page.evaluate(() => ({
    version: window.__MATHCHA_TOOLKIT__?.version ?? null,
    platform: window.__MATHCHA_TOOLKIT__?.platform ?? null,
    commandKeys: Object.keys(window.__MATHCHA_TOOLKIT__?.commands ?? {})
  }));

  expect(toolkit.platform).toBe("console");
  expect(toolkit.commandKeys).toEqual(["copyLatex", "analyze", "symbolab", "answer", "pasteFromLatex"]);

  await selectWelcomeMath(page);
  await page.evaluate(async () => {
    await window.__MATHCHA_TOOLKIT__?.commands.copyLatex();
  });

  const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
  expect(clipboardText.length).toBeGreaterThan(0);
});
