import { test, expect } from "@playwright/test";
import {
  appendMathAtSelectionEnd,
  createActiveDocumentCapture,
  createProbeState,
  installRuntimeProbe,
  prepareMathchaPage,
  readRuntimeProbe,
  wireNetworkCapture,
  writeArtifacts
} from "./support.mjs";

async function runAnswerInsertScenario(page, context, insertionLatex) {
  const probeState = createProbeState();
  const activeDocumentCapture = createActiveDocumentCapture();
  const pageErrors = [];

  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });

  await installRuntimeProbe(page);
  const networkCapture = await wireNetworkCapture(page, probeState, activeDocumentCapture);
  await prepareMathchaPage(page, context);

  const result = await appendMathAtSelectionEnd(page, insertionLatex);

  await networkCapture.flush();
  const runtimeProbe = await readRuntimeProbe(page);

  return {
    probeState,
    activeDocumentCapture,
    result,
    runtimeProbe,
    pageErrors
  };
}

test("appends exact fraction answers after the selected math instead of replacing it", async ({ page, context }) => {
  const { probeState, activeDocumentCapture, result, runtimeProbe, pageErrors } = await runAnswerInsertScenario(
    page,
    context,
    "=\\frac{3}{2}"
  );

  const report = {
    reportTitle: "Mathcha Runtime Answer Insert Summary",
    pageTitle: await page.title(),
    pageUrl: page.url(),
    windowCandidates: [],
    mathGlobalSummary: null,
    documentModelSummary: activeDocumentCapture.documentModelSummary,
    answerInsertResult: result,
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

  const artifactPaths = await writeArtifacts("mathcha-runtime-answer-insert", report);
  test.info().annotations.push({ type: "artifact-json", description: artifactPaths.jsonPath });
  test.info().annotations.push({ type: "artifact-md", description: artifactPaths.mdPath });

  expect(report.pageUrl).toContain("mathcha.io");
  expect(result.ok).toBeTruthy();
  expect(result.changed).toBeTruthy();
  expect(result.dialogStillOpen).toBeFalsy();
  expect(result.selectedBefore).toBe("F");
  expect(result.targetLineHasEquals).toBeTruthy();
  expect(result.afterModelJson).toContain("\\frac");
  expect(pageErrors).toEqual([]);
});

test("appends decimal answers as literal decimal math content", async ({ page, context }) => {
  const { result, pageErrors } = await runAnswerInsertScenario(page, context, "=1.5");

  expect(result.ok).toBeTruthy();
  expect(result.changed).toBeTruthy();
  expect(result.dialogStillOpen).toBeFalsy();
  expect(result.targetLineHasEquals).toBeTruthy();
  expect(result.combinedTargetLineText).toContain("1.5");
  expect(pageErrors).toEqual([]);
});

test("appends mixed-number answers as parser-safe sum math", async ({ page, context }) => {
  const { result, pageErrors } = await runAnswerInsertScenario(page, context, "=1+\\frac{1}{2}");

  expect(result.ok).toBeTruthy();
  expect(result.changed).toBeTruthy();
  expect(result.dialogStillOpen).toBeFalsy();
  expect(result.targetLineHasEquals).toBeTruthy();
  expect(result.combinedTargetLineText).toContain("1");
  expect(result.afterModelJson).toContain("\\frac");
  expect(pageErrors).toEqual([]);
});
