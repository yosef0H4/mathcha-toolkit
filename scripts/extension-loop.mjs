import { spawn } from "node:child_process";
import path from "node:path";

const rootDir = path.resolve(".");

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });

const chromiumExtensionPath = path.join(rootDir, "dist", "extension", "chromium");
const firefoxExtensionPath = path.join(rootDir, "dist", "extension", "firefox");
const consoleBundlePath = path.join(rootDir, "dist", "mathcha-toolkit.console.js");

try {
  await run("npm", ["run", "typecheck"]);
  await run("npm", ["run", "build"]);
  await run("npm", ["run", "pw:extension"]);

  console.log("");
  console.log("[loop:extension] Chromium extension smoke tests passed.");
  console.log(`[loop:extension] Chromium extension: ${chromiumExtensionPath}`);
  console.log(`[loop:extension] Firefox extension: ${firefoxExtensionPath}`);
  console.log(`[loop:extension] Console bundle: ${consoleBundlePath}`);
  console.log("[loop:extension] Firefox manual run:");
  console.log("  npm run dev:extension:firefox");
} catch (error) {
  console.error("");
  console.error("[loop:extension] Failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
