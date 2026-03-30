import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baselinePath = process.argv[2];
const currentPath = process.argv[3];

if (!baselinePath || !currentPath) {
  console.error("Usage: node src/compare-build.mjs <baseline> <current>");
  process.exit(1);
}

const normalize = (input) => {
  const lf = input.replace(/\r\n/g, "\n");
  const withoutBanner = lf.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n*/u, "");
  return withoutBanner
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
};

const [baselineRaw, currentRaw] = await Promise.all([
  readFile(baselinePath, "utf8"),
  readFile(currentPath, "utf8")
]);

const baseline = normalize(baselineRaw);
const current = normalize(currentRaw);
const same = baseline === current;
const reportPath = path.resolve("playwright-output/refactor-baseline/compare-report.txt");

if (same) {
  await writeFile(reportPath, "Normalized build output matches baseline.\n");
  console.log("Normalized build output matches baseline.");
  process.exit(0);
}

let firstDiff = -1;
for (let index = 0; index < Math.min(baseline.length, current.length); index += 1) {
  if (baseline[index] !== current[index]) {
    firstDiff = index;
    break;
  }
}
if (firstDiff === -1) {
  firstDiff = Math.min(baseline.length, current.length);
}

const report = [
  "Normalized build output differs from baseline.",
  `Baseline length: ${baseline.length}`,
  `Current length: ${current.length}`,
  `First diff index: ${firstDiff}`,
  "",
  `Baseline snippet: ${baseline.slice(firstDiff, firstDiff + 200)}`,
  "",
  `Current snippet: ${current.slice(firstDiff, firstDiff + 200)}`
].join("\n");

await writeFile(reportPath, report + "\n");
console.log(report);
process.exit(0);
