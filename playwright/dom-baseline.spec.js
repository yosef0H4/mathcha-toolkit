import { test, expect } from "@playwright/test";
import {
  createActiveDocumentCapture,
  createProbeState,
  installRuntimeProbe,
  prepareMathchaPage,
  readRuntimeProbe,
  wireNetworkCapture,
  writeArtifacts
} from "./support.mjs";

test("captures the current DOM baseline for the editor context-menu path", async ({ page, context }) => {
  const probeState = createProbeState();
  const activeDocumentCapture = createActiveDocumentCapture();

  await installRuntimeProbe(page);
  const networkCapture = await wireNetworkCapture(page, probeState, activeDocumentCapture);
  await prepareMathchaPage(page, context);

  let contextMenuProbe = null;
  let copyLatexButtonProbe = null;

  const firstMathCharacter = page.locator("text=F").first();
  if (await firstMathCharacter.count()) {
    await firstMathCharacter.click({ force: true });
    await firstMathCharacter.click({ button: "right", force: true });
    await page.waitForTimeout(500);

    contextMenuProbe = await page.evaluate(() => {
      const menuItems = Array.from(document.querySelectorAll("ct-item"))
        .map((item) => ({
          className: item.className,
          text: item.textContent?.trim() ?? ""
        }))
        .filter((item) => item.className || item.text)
        .slice(0, 20);

      return {
        menuItems,
        activeElement: document.activeElement
          ? {
              tagName: document.activeElement.tagName,
              className: document.activeElement.className
            }
          : null
      };
    });

    const copyLatexButton = page.locator("ct-item.clipboard.copy-latex").first();
    if (await copyLatexButton.count()) {
      const buttonText = (await copyLatexButton.textContent())?.trim() ?? "";
      await copyLatexButton.click({ force: true });
      await page.waitForTimeout(500);

      copyLatexButtonProbe = await page.evaluate(async () => {
        let clipboardText = "";
        try {
          clipboardText = await navigator.clipboard.readText();
        } catch {
          clipboardText = "";
        }

        return {
          clipboardText: {
            length: clipboardText.length,
            preview: clipboardText.slice(0, 300)
          }
        };
      });

      copyLatexButtonProbe.buttonText = buttonText;
    }
  }

  await networkCapture.flush();
  const runtimeProbe = await readRuntimeProbe(page);
  const interestingRequests = probeState.requests
    .values()
    .filter((request) => /mathcha|graphql|api|copy|latex|editor|document|save/i.test(request.url));
  const failingResponses = probeState.responses.values().filter((response) => response.status >= 400);

  const report = {
    reportTitle: "Mathcha DOM Baseline Summary",
    pageTitle: await page.title(),
    pageUrl: page.url(),
    windowCandidates: [],
    mathGlobalSummary: null,
    documentModelSummary: activeDocumentCapture.documentModelSummary,
    contextMenuProbe,
    copyLatexButtonProbe,
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

  const artifactPaths = await writeArtifacts("mathcha-dom-baseline", report);
  test.info().annotations.push({ type: "artifact-json", description: artifactPaths.jsonPath });
  test.info().annotations.push({ type: "artifact-md", description: artifactPaths.mdPath });

  expect(report.pageUrl).toContain("mathcha.io");
});
