import { test, expect } from "@playwright/test";
import {
  createActiveDocumentCapture,
  createProbeState,
  importLatexThroughDirectRuntime,
  importLatexThroughRuntimeDialog,
  installRuntimeProbe,
  prepareMathchaPage,
  readRuntimeProbe,
  wireNetworkCapture,
  writeArtifacts
} from "./support.mjs";

test("imports LaTeX through the direct runtime parser path as parsed math, not raw latex text", async ({ page, context }) => {
  const probeState = createProbeState();
  const activeDocumentCapture = createActiveDocumentCapture();

  await installRuntimeProbe(page);
  const networkCapture = await wireNetworkCapture(page, probeState, activeDocumentCapture);
  await prepareMathchaPage(page, context);

  const cases = [{ latex: "2^2" }, { latex: "\\frac{a}{b}" }, { latex: "\\sqrt{a}" }];

  const results = [];
  for (const entry of cases) {
    const directResult = await importLatexThroughDirectRuntime(page, entry.latex);
    let fallbackResult = null;
    if (!directResult.ok) {
      await prepareMathchaPage(page, context);
      fallbackResult = await importLatexThroughRuntimeDialog(page, entry.latex);
    }
    results.push({
      latex: entry.latex,
      directResult,
      fallbackResult
    });
    await prepareMathchaPage(page, context);
  }

  await networkCapture.flush();
  const runtimeProbe = await readRuntimeProbe(page);

  const report = {
    reportTitle: "Mathcha Runtime Import Summary",
    pageTitle: await page.title(),
    pageUrl: page.url(),
    windowCandidates: [],
    mathGlobalSummary: null,
    documentModelSummary: activeDocumentCapture.documentModelSummary,
    importResults: results,
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

  const artifactPaths = await writeArtifacts("mathcha-runtime-import", report);
  test.info().annotations.push({ type: "artifact-json", description: artifactPaths.jsonPath });
  test.info().annotations.push({ type: "artifact-md", description: artifactPaths.mdPath });

  expect(report.pageUrl).toContain("mathcha.io");
  for (const entry of results) {
    expect(entry.directResult.ok, `${entry.latex} should import successfully through the direct path`).toBeTruthy();
    expect(entry.directResult.changed, `${entry.latex} should change the editor model`).toBeTruthy();
    expect(entry.directResult.dialogStillOpen, `${entry.latex} should not leave the import dialog open`).toBeFalsy();
    expect(entry.directResult.effectiveMathMode, `${entry.latex} should force math-mode parsing`).toBeTruthy();
    expect(entry.directResult.firstLineHasComposite, `${entry.latex} should produce parsed composite math blocks`).toBeTruthy();
    expect(entry.directResult.firstLineContainsLiteralInput, `${entry.latex} should not remain as the literal source string`).toBeFalsy();
    expect(entry.fallbackResult, `${entry.latex} should not require dialog fallback`).toBeNull();
  }
});
