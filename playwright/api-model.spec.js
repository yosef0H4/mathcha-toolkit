import { test, expect } from "@playwright/test";
import {
  collectDomModelBridge,
  createActiveDocumentCapture,
  createProbeState,
  pickInterestingWindowKeys,
  prepareMathchaPage,
  readPageSummary,
  summarizeValueShape,
  wireNetworkCapture,
  writeArtifacts
} from "./support.mjs";

test("captures the active document model from Mathcha APIs", async ({ page, context }) => {
  const probeState = createProbeState();
  const activeDocumentCapture = createActiveDocumentCapture();
  const networkCapture = await wireNetworkCapture(page, probeState, activeDocumentCapture);

  await prepareMathchaPage(page, context);
  await networkCapture.flush();

  const pageSummary = await readPageSummary(page);
  const interestingRequests = probeState.requests
    .values()
    .filter((request) => /mathcha|graphql|api|copy|latex|editor|document|save/i.test(request.url));
  const failingResponses = probeState.responses.values().filter((response) => response.status >= 400);
  const domModelBridge = await collectDomModelBridge(page, activeDocumentCapture.documentModelSummary?.sampleBlockIds ?? []);

  const report = {
    reportTitle: "Mathcha API Model Summary",
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
    documentName: activeDocumentCapture.documentName,
    documentParseError: activeDocumentCapture.parseError,
    domModelBridge,
    selectionState: pageSummary.selectionState,
    networkSummary: {
      requestCount: probeState.requests.values().length,
      responseCount: probeState.responses.values().length,
      interestingRequests,
      apiResponses: probeState.apiResponses.values(),
      failingResponses
    }
  };

  const artifactPaths = await writeArtifacts("mathcha-api-model", report);
  test.info().annotations.push({ type: "artifact-json", description: artifactPaths.jsonPath });
  test.info().annotations.push({ type: "artifact-md", description: artifactPaths.mdPath });

  expect(report.pageUrl).toContain("mathcha.io");
  expect(report.documentModelSummary?.mathContainerCount ?? 0).toBeGreaterThan(0);
});
