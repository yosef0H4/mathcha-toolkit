import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const extensionDir = path.join(distDir, "extension");
const chromiumDir = path.join(extensionDir, "chromium");
const firefoxDir = path.join(extensionDir, "firefox");
const userscriptHeader = await fs.readFile(path.join(rootDir, "userscript.header.txt"), "utf8");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

const sharedOptions = {
  bundle: true,
  format: "iife",
  target: "es2020",
  charset: "utf8",
  legalComments: "none",
  sourcemap: false
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

await Promise.all([ensureDir(distDir), ensureDir(chromiumDir), ensureDir(firefoxDir)]);

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "userscript.ts")],
  outfile: path.join(distDir, "mathcha-toolkit.user.js"),
  banner: {
    js: userscriptHeader.trimEnd()
  }
});

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "console-entry.ts")],
  outfile: path.join(distDir, "mathcha-toolkit.console.js")
});

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "extension-page.ts")],
  outfile: path.join(chromiumDir, "page.js")
});

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "extension-content.ts")],
  outfile: path.join(chromiumDir, "content.js")
});

await build({
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "extension-background.ts")],
  outfile: path.join(chromiumDir, "background.js")
});

for (const filename of ["page.js", "content.js", "background.js"]) {
  await fs.copyFile(path.join(chromiumDir, filename), path.join(firefoxDir, filename));
}

const chromiumManifest = {
  manifest_version: 3,
  name: "Mathcha Toolkit",
  version: packageJson.version,
  description: "Calculator, LaTeX, and AI workflow tools for Mathcha.io",
  permissions: ["storage", "tabs"],
  host_permissions: ["https://*.mathcha.io/*"],
  background: {
    service_worker: "background.js"
  },
  content_scripts: [
    {
      matches: ["https://*.mathcha.io/*"],
      js: ["content.js"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["page.js"],
      matches: ["https://*.mathcha.io/*"]
    }
  ]
};

const firefoxManifest = {
  manifest_version: 2,
  name: "Mathcha Toolkit",
  version: packageJson.version,
  description: "Calculator, LaTeX, and AI workflow tools for Mathcha.io",
  permissions: ["storage", "tabs", "https://*.mathcha.io/*"],
  background: {
    scripts: ["background.js"]
  },
  content_scripts: [
    {
      matches: ["https://*.mathcha.io/*"],
      js: ["content.js"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: ["page.js"],
  browser_specific_settings: {
    gecko: {
      id: "mathcha-toolkit@example.local",
      strict_min_version: "142.0",
      data_collection_permissions: {
        required: ["none"]
      }
    }
  }
};

await fs.writeFile(path.join(chromiumDir, "manifest.json"), `${JSON.stringify(chromiumManifest, null, 2)}\n`);
await fs.writeFile(path.join(firefoxDir, "manifest.json"), `${JSON.stringify(firefoxManifest, null, 2)}\n`);
