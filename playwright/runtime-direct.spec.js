import { test, expect } from "@playwright/test";
import {
  attemptDirectRuntimeInvocation,
  createActiveDocumentCapture,
  createProbeState,
  installRuntimeProbe,
  prepareMathchaPage,
  replayCompositeNodeSelection,
  readRuntimeProbe,
  replayKnownInlineMathSelection,
  snapshotSelectionState,
  wireNetworkCapture,
  writeArtifacts,
  writeSnippetExtraction
} from "./support.mjs";

test("attempts direct runtime Copy LaTeX invocation without opening the context menu", async ({ page, context }) => {
  const probeState = createProbeState();
  const activeDocumentCapture = createActiveDocumentCapture();

  await installRuntimeProbe(page);
  const networkCapture = await wireNetworkCapture(page, probeState, activeDocumentCapture);
  await prepareMathchaPage(page, context);

  const replayedCompositeNodeSelections = [];
  for (const selector of [
    "compositeblock.over-arrow-symbol",
    "compositeblock.fraction-symbol",
    "compositeblock.sqrt-symbol"
  ]) {
    replayedCompositeNodeSelections.push({
      selector,
      result: await replayCompositeNodeSelection(page, selector, { charSpan: 1 })
    });
    await prepareMathchaPage(page, context);
  }

  await prepareMathchaPage(page, context);
  const replayedInlineMathSelection = await replayKnownInlineMathSelection(page);
  const selectionSnapshots = [await snapshotSelectionState(page, "before-interaction")];
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
  }

  const directInvocation = await attemptDirectRuntimeInvocation(page);
  await networkCapture.flush();
  const runtimeProbe = await readRuntimeProbe(page);

  const successfulOperations = directInvocation.attempts.flatMap((attempt) =>
    attempt.operationResults
      .filter((result) => result.ok && result.returnSummary?.type === "string" && result.returnSummary.length > 0)
      .map((result) => ({
        source: attempt.source,
        name: result.name,
        returnSummary: result.returnSummary
      }))
  );

  let snippetExtractionPath = null;
  if (successfulOperations.length === 0) {
    snippetExtractionPath = await writeSnippetExtraction("mathcha-runtime-direct", [
      { label: "copyAction", start: 57779, end: 57835 },
      { label: "getSelectedLatex", start: 61008, end: 61034 },
      { label: "executeCopy", start: 61504, end: 61533 },
      { label: "copy-latex-menu", start: 71161, end: 71175 },
      { label: "requestCopyLatex", start: 71788, end: 71798 },
      { label: "editor-handler-wiring", start: 91935, end: 91976 }
    ]);
  }

  const report = {
    reportTitle: "Mathcha Direct Runtime Invocation Summary",
    pageTitle: await page.title(),
    pageUrl: page.url(),
    windowCandidates: [],
    mathGlobalSummary: null,
    documentModelSummary: activeDocumentCapture.documentModelSummary,
    selectionSnapshots,
    directInvocation,
    wrapperTraces: directInvocation.wrapperTraces,
    replayedInlineMathSelection,
    replayedCompositeNodeSelections,
    successfulOperations,
    snippetExtractionPath,
    probeEvents: runtimeProbe.eventLog,
    listenerRegistrations: runtimeProbe.listenerLog,
    clipboardWrites: runtimeProbe.clipboardLog,
    runtimeNetworkLog: runtimeProbe.networkLog,
    networkSummary: {
      requestCount: probeState.requests.values().length,
      responseCount: probeState.responses.values().length,
      interestingRequests: probeState.requests
        .values()
        .filter((request) => /mathcha|graphql|api|copy|latex|editor|document|save/i.test(request.url)),
      apiResponses: probeState.apiResponses.values(),
      failingResponses: probeState.responses.values().filter((response) => response.status >= 400)
    }
  };

  const artifactPaths = await writeArtifacts("mathcha-runtime-direct", report);
  test.info().annotations.push({ type: "artifact-json", description: artifactPaths.jsonPath });
  test.info().annotations.push({ type: "artifact-md", description: artifactPaths.mdPath });
  if (snippetExtractionPath) {
    test.info().annotations.push({ type: "analysis-json", description: snippetExtractionPath });
  }

  expect(report.pageUrl).toContain("mathcha.io");
  expect(replayedInlineMathSelection.ok).toBeTruthy();
  expect(replayedInlineMathSelection.latex).toBe("F");
  expect(replayedCompositeNodeSelections.every((entry) => entry.result.ok)).toBeTruthy();
  expect(replayedCompositeNodeSelections[0].result.latex).toBe("F");
  expect(replayedCompositeNodeSelections[1].result.latex).toBe("a");
  expect(replayedCompositeNodeSelections[2].result.latex).toBe("a");
  expect(Boolean(directInvocation.candidateCount > 0 || snippetExtractionPath)).toBeTruthy();
});
