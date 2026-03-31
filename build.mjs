import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const banner = await readFile(new URL("./userscript.header.txt", import.meta.url), "utf8");

await build({
  entryPoints: ["src/script.ts"],
  outfile: "dist/mathcha-toolkit.user.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  charset: "utf8",
  legalComments: "none",
  banner: {
    js: banner.trimEnd()
  }
});
