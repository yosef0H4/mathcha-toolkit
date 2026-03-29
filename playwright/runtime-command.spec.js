import { test, expect } from "@playwright/test";
import {
  createActiveDocumentCapture,
  createProbeState,
  installRuntimeProbe,
  pickInterestingWindowKeys,
  prepareMathchaPage,
  readPageSummary,
  readRuntimeProbe,
  snapshotSelectionState,
  summarizeValueShape,
  wireNetworkCapture,
  writeArtifacts
} from "./support.mjs";

test("captures runtime command and selection signals without using the context menu", async ({ page, context }) => {
  const probeState = createProbeState();
  const activeDocumentCapture = createActiveDocumentCapture();

  await installRuntimeProbe(page);
  const networkCapture = await wireNetworkCapture(page, probeState, activeDocumentCapture);
  await prepareMathchaPage(page, context);

  const selectionSnapshots = [await snapshotSelectionState(page, "before-interaction")];
  let keyboardCopyResult = null;

  const mathTextLocator = page.locator("text=Input your mathematics formula inline:");
  if (await mathTextLocator.count()) {
    await mathTextLocator.first().click();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(300);
    selectionSnapshots.push(await snapshotSelectionState(page, "after-keyboard-selection"));
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(300);
    keyboardCopyResult = await page.evaluate(async () => {
      try {
        const text = await navigator.clipboard.readText();
        return {
          length: text.length,
          preview: text.slice(0, 300)
        };
      } catch (error) {
        return {
          error: String(error)
        };
      }
    });
  }

  await networkCapture.flush();
  const runtimeProbe = await readRuntimeProbe(page);
  const pageSummary = await readPageSummary(page);
  const interestingRequests = probeState.requests
    .values()
    .filter((request) => /mathcha|graphql|api|copy|latex|editor|document|save/i.test(request.url));
  const failingResponses = probeState.responses.values().filter((response) => response.status >= 400);

  const report = {
    reportTitle: "Mathcha Runtime Command Summary",
    pageTitle: pageSummary.title,
    pageUrl: pageSummary.url,
    windowCandidates: pickInterestingWindowKeys(pageSummary.windowKeys),
    mathGlobalSummary: pageSummary.mathGlobalSummary
      ? {
          typeof: pageSummary.mathGlobalSummary.typeof,
          keys: pageSummary.mathGlobalSummary.keys.slice(0, 80),
          sample: summarizeValueShape(pageSummary.mathGlobalSummary.sample)
        }
      : null,
    commandCandidates: pageSummary.commandCandidates,
    mathDataSummary: pageSummary.mathDataSummary
      ? {
          rawLength: pageSummary.mathDataSummary.rawLength,
          parsedShape: summarizeValueShape(pageSummary.mathDataSummary.parsedShape)
        }
      : null,
    documentModelSummary: activeDocumentCapture.documentModelSummary,
    selectionSnapshots,
    keyboardCopyResult,
    selectionState: pageSummary.selectionState,
    probeEvents: runtimeProbe.eventLog,
    listenerRegistrations: runtimeProbe.listenerLog,
    clipboardWrites: runtimeProbe.clipboardLog,
    runtimeNetworkLog: runtimeProbe.networkLog,
    networkSummary: {
      requestCount: probeState.requests.values().length,
      responseCount: probeState.responses.values().length,
      interestingRequests,
      apiResponses: probeState.apiResponses.values(),
      failingResponses
    }
  };

  const artifactPaths = await writeArtifacts("mathcha-runtime-command", report);
  test.info().annotations.push({ type: "artifact-json", description: artifactPaths.jsonPath });
  test.info().annotations.push({ type: "artifact-md", description: artifactPaths.mdPath });

  expect(report.pageUrl).toContain("mathcha.io");
  expect(report.probeEvents.length).toBeGreaterThan(0);
});
