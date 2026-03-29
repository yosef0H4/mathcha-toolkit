import fs from "node:fs/promises";
import path from "node:path";

export const storageStatePath = path.resolve("playwright-output/auth/storage-state.json");
const reportDir = path.resolve("playwright-output/reports");
const analysisDir = path.resolve("playwright-output/analysis");

export async function ensureReportDir() {
  await fs.mkdir(reportDir, { recursive: true });
}

export async function ensureAnalysisDir() {
  await fs.mkdir(analysisDir, { recursive: true });
}

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function pickInterestingWindowKeys(keys) {
  return keys
    .filter((key) => /math|editor|model|store|redux|mobx|state|selection|latex|copy/i.test(key))
    .sort();
}

export function summarizeValueShape(value, depth = 0) {
  if (value === null) return { type: "null" };
  if (value === undefined) return { type: "undefined" };
  if (depth > 2) return { type: Array.isArray(value) ? "array" : typeof value };

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 3).map((item) => summarizeValueShape(item, depth + 1))
    };
  }

  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 20);
    return {
      type: "object",
      keys,
      sample: Object.fromEntries(keys.slice(0, 8).map((key) => [key, summarizeValueShape(value[key], depth + 1)]))
    };
  }

  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      preview: value.slice(0, 160)
    };
  }

  return {
    type: typeof value,
    value
  };
}

export function createBoundedStore(limit = 200) {
  const items = [];
  return {
    push(item) {
      if (items.length < limit) {
        items.push(item);
      }
    },
    values() {
      return items;
    }
  };
}

export function createProbeState() {
  return {
    requests: createBoundedStore(200),
    responses: createBoundedStore(200),
    apiResponses: createBoundedStore(20)
  };
}

export function summarizeDocumentModel(documentModel) {
  const summary = {
    lineCount: 0,
    blockCount: 0,
    mathContainerCount: 0,
    textBlockCount: 0,
    compositeTypeCount: {},
    sampleText: [],
    mathContainerSamples: [],
    sampleBlockIds: []
  };

  function visitLines(lines) {
    if (!Array.isArray(lines)) return;

    for (const line of lines) {
      summary.lineCount += 1;
      visitBlocks(line?.blocks);
    }
  }

  function visitBlocks(blocks) {
    if (!Array.isArray(blocks)) return;

    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;

      summary.blockCount += 1;
      if (typeof block.id === "string" && summary.sampleBlockIds.length < 12) {
        summary.sampleBlockIds.push(block.id);
      }

      if (typeof block.text === "string" && block.type !== "composite") {
        summary.textBlockCount += 1;
        if (summary.sampleText.length < 8) {
          summary.sampleText.push(block.text.slice(0, 120));
        }
      }

      if (block.type === "composite") {
        const compositeName = typeof block.text === "string" ? block.text : "[unknown]";
        summary.compositeTypeCount[compositeName] = (summary.compositeTypeCount[compositeName] ?? 0) + 1;

        if (block.text === "\\math-container") {
          summary.mathContainerCount += 1;
          if (summary.mathContainerSamples.length < 5) {
            summary.mathContainerSamples.push({
              id: typeof block.id === "string" ? block.id : null,
              displayMode: Boolean(block.displayMode),
              elementKeys: Object.keys(block.elements ?? {})
            });
          }
        }

        for (const value of Object.values(block.elements ?? {})) {
          if (value && typeof value === "object" && Array.isArray(value.lines)) {
            visitLines(value.lines);
          }
        }
      }
    }
  }

  visitLines(documentModel?.lines);
  return summary;
}

export function createActiveDocumentCapture() {
  return {
    documentModelSummary: null,
    rawDocumentData: null,
    documentName: null,
    parseError: null
  };
}

export async function wireNetworkCapture(page, probeState, activeDocumentCapture) {
  const responseTasks = [];

  page.on("request", (request) => {
    probeState.requests.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType()
    });
  });

  page.on("response", (response) => {
    const task = (async () => {
      const summary = {
        status: response.status(),
        url: response.url(),
        contentType: response.headers()["content-type"] ?? ""
      };
      probeState.responses.push(summary);

      if (!/api\/(documents|init)/i.test(summary.url)) {
        return;
      }

      try {
        const bodyText = await response.text();
        probeState.apiResponses.push({
          ...summary,
          bodyPreview: bodyText.slice(0, 4000)
        });

        if (/api\/documents\/active2/i.test(summary.url)) {
          try {
            const parsedActiveResponse = JSON.parse(bodyText);
            const rawDocumentData = parsedActiveResponse?.documentResponse?.data;
            const parsedDocumentModel = typeof rawDocumentData === "string" ? JSON.parse(rawDocumentData) : null;
            activeDocumentCapture.documentModelSummary = summarizeDocumentModel(parsedDocumentModel);
            activeDocumentCapture.rawDocumentData = rawDocumentData;
            activeDocumentCapture.documentName = parsedActiveResponse?.documentResponse?.name ?? null;
            activeDocumentCapture.parseError = null;
          } catch {
            activeDocumentCapture.parseError = "Unable to parse active document response";
          }
        }
      } catch {
        probeState.apiResponses.push({
          ...summary,
          bodyPreview: "[unavailable]"
        });
      }
    })();

    responseTasks.push(task);
  });

  return {
    async flush() {
      await Promise.all(responseTasks);
    }
  };
}

export async function prepareMathchaPage(page, context) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://www.mathcha.io"
  });

  await page.goto("/editor", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    for (const selector of ["quick-start", "overlay", "qs-guide-board-container"]) {
      for (const node of document.querySelectorAll(selector)) {
        node.remove();
      }
    }
  });
}

export async function installRuntimeProbe(page) {
  await page.addInitScript(() => {
    const limits = {
      eventLog: 200,
      listenerLog: 200,
      clipboardLog: 50,
      networkLog: 50
    };

    const state = {
      eventLog: [],
      listenerLog: [],
      clipboardLog: [],
      networkLog: []
    };

    const pushBounded = (bucket, item, limit) => {
      if (bucket.length < limit) {
        bucket.push(item);
      }
    };

    window.__mathchaProbe = state;

    const recordEvent = (eventName, detail = {}) => {
      pushBounded(
        state.eventLog,
        {
          eventName,
          detail,
          timestamp: Date.now()
        },
        limits.eventLog
      );
    };

    const interestingListenerEvent = /^(contextmenu|copy|keydown|beforeinput|pointerdown|mousedown)$/;
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
      if (interestingListenerEvent.test(String(type)) && typeof listener === "function") {
        const targetSummary =
          this instanceof Element
            ? {
                tagName: this.tagName,
                className: this.className
              }
            : {
                type: this?.constructor?.name ?? typeof this
              };

        pushBounded(
          state.listenerLog,
          {
            type,
            listenerName: listener.name || "[anonymous]",
            targetSummary,
            stackPreview: String(new Error().stack ?? "")
              .split("\n")
              .slice(1, 5)
              .join("\n"),
            options: typeof options === "object" ? { capture: Boolean(options?.capture) } : options
          },
          limits.listenerLog
        );
      }

      return originalAddEventListener.call(this, type, listener, options);
    };

    document.addEventListener("selectionchange", () => {
      recordEvent("selectionchange", {
        textLength: window.getSelection()?.toString().length ?? 0
      });
    });

    document.addEventListener("copy", () => recordEvent("copy"));
    document.addEventListener("contextmenu", (event) => {
      recordEvent("contextmenu", {
        target: event.target instanceof Element ? event.target.tagName : "unknown"
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) {
        recordEvent("keydown", {
          key: event.key,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey
        });
      }
    });

    if (navigator.clipboard?.writeText) {
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        pushBounded(
          state.clipboardLog,
          {
            type: "writeText",
            length: text.length,
            preview: text.slice(0, 300),
            stackPreview: String(new Error().stack ?? "")
              .split("\n")
              .slice(1, 5)
              .join("\n"),
            timestamp: Date.now()
          },
          limits.clipboardLog
        );
        return originalWriteText(text);
      };
    }

    if (Document.prototype.execCommand) {
      const originalExecCommand = Document.prototype.execCommand;
      Document.prototype.execCommand = function patchedExecCommand(commandId, showUI, value) {
        recordEvent("execCommand", {
          commandId,
          valuePreview: typeof value === "string" ? value.slice(0, 120) : typeof value
        });
        return originalExecCommand.call(this, commandId, showUI, value);
      };
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const requestInfo = args[0];
      const url = typeof requestInfo === "string" ? requestInfo : requestInfo?.url ?? "";
      if (/documents|copy|latex|export/i.test(url)) {
        pushBounded(
          state.networkLog,
          {
            type: "fetch",
            url,
            stackPreview: String(new Error().stack ?? "")
              .split("\n")
              .slice(1, 5)
              .join("\n")
          },
          limits.networkLog
        );
      }

      return originalFetch(...args);
    };
  });
}

export async function snapshotSelectionState(page, label) {
  return page.evaluate((currentLabel) => {
    const collectStorageKeys = (storage) => {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
      return keys.sort();
    };

    const shallowObject = (value) => {
      if (!value || typeof value !== "object") {
        return { type: typeof value };
      }

      return {
        type: "object",
        keys: Object.keys(value).slice(0, 20)
      };
    };

    return {
      label: currentLabel,
      title: document.title,
      activeElement: document.activeElement
        ? {
            tagName: document.activeElement.tagName,
            className: document.activeElement.className,
            role: document.activeElement.getAttribute("role")
          }
        : null,
      selectionTextLength: window.getSelection()?.toString().length ?? 0,
      mathGlobalKeys: window.mathGlobal && typeof window.mathGlobal === "object" ? Object.keys(window.mathGlobal).sort() : [],
      mathGlobalInitDataShape: shallowObject(window.mathGlobal?.initData),
      localStorageKeys: collectStorageKeys(localStorage),
      sessionStorageKeys: collectStorageKeys(sessionStorage),
      probeEventCount: window.__mathchaProbe?.eventLog?.length ?? 0
    };
  }, label);
}

export async function readRuntimeProbe(page) {
  return page.evaluate(() => ({
    eventLog: window.__mathchaProbe?.eventLog ?? [],
    listenerLog: window.__mathchaProbe?.listenerLog ?? [],
    clipboardLog: window.__mathchaProbe?.clipboardLog ?? [],
    networkLog: window.__mathchaProbe?.networkLog ?? []
  }));
}

export async function replayKnownInlineMathSelection(page) {
  return page.evaluate(async () => {
    const inst = document.querySelector("math-type")?.reactInstance;
    if (!inst?.setSelection || !inst?.latexIoHandler?.getSelectedLatex) {
      return {
        ok: false,
        reason: "math-type.reactInstance selection APIs not available"
      };
    }

    const safe = (value, depth = 0) => {
      if (value === undefined) return "[undefined]";
      if (value === null) return null;
      if (typeof value !== "object") return value;
      if (depth > 3) return typeof value;
      if (Array.isArray(value)) return value.slice(0, 8).map((item) => safe(item, depth + 1));
      const out = {};
      for (const key of Object.keys(value).slice(0, 20)) {
        out[key] = safe(value[key], depth + 1);
      }
      return out;
    };

    // Selection payload captured from a real click on the inline math example in the anonymous welcome doc.
    const start = {
      key: "mathValue",
      selected: {
        key: "value",
        selected: { lineIndex: 0, charIndex: 0 },
        lineIndex: 0,
        charIndex: 0
      },
      lineIndex: 3,
      charIndex: 39
    };
    const end = {
      key: "mathValue",
      selected: {
        key: "value",
        selected: { lineIndex: 0, charIndex: 1 },
        lineIndex: 0,
        charIndex: 0
      },
      lineIndex: 3,
      charIndex: 39
    };

    inst.clearSelection?.();
    inst.setCursorInputFocus?.(true);
    inst.setCursorMathTypeFocus?.(true);
    inst.setSelection(start, end);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const model = inst.getContainerModel?.();
    return {
      ok: true,
      latex: inst.latexIoHandler.getSelectedLatex("latex-latex", false) ?? "",
      json: inst.getSelectedJson?.() ?? "",
      cursorSelected: safe(model?.cursorSelected),
      extendedCursorSelected: safe(model?.extendedCursorSelected)
    };
  });
}

export async function replayCompositeNodeSelection(page, selector, options = {}) {
  const { anchorSelection = null, charSpan = 1 } = options;
  return page.evaluate(
    async ({ targetSelector, targetAnchorSelection, targetCharSpan }) => {
      const inst = document.querySelector("math-type")?.reactInstance;
      const node = document.querySelector(targetSelector)?.reactInstance;
      if (!inst?.setSelection || !node?.props?.onSelectedChanged) {
        return {
          ok: false,
          reason: "Required runtime hooks are not available"
        };
      }

      const deepClone = (value) => JSON.parse(JSON.stringify(value));
      const bumpDeepestCharIndex = (selection, delta) => {
        const clone = deepClone(selection);
        let cursor = clone;

        while (cursor && typeof cursor === "object" && cursor.selected && typeof cursor.selected === "object") {
          if ("charIndex" in cursor.selected && !("key" in cursor.selected)) {
            cursor.selected.charIndex += delta;
            return clone;
          }
          cursor = cursor.selected;
        }

        if (cursor && typeof cursor === "object" && "charIndex" in cursor) {
          cursor.charIndex += delta;
        }

        return clone;
      };

      const inferredAnchorSelection =
        targetAnchorSelection ??
        (() => {
          const elementKeys = Object.keys(node.props?.data?.elements ?? {});
          return {
            key: elementKeys[0] ?? "value",
            selected: { lineIndex: 0, charIndex: 0 }
          };
        })();

      const safe = (value, depth = 0) => {
        if (value === undefined) return "[undefined]";
        if (value === null) return null;
        if (typeof value !== "object") return value;
        if (depth > 3) return typeof value;
        if (Array.isArray(value)) return value.slice(0, 8).map((item) => safe(item, depth + 1));
        const out = {};
        for (const key of Object.keys(value).slice(0, 20)) {
          out[key] = safe(value[key], depth + 1);
        }
        return out;
      };

      inst.clearSelection?.();
      inst.setCursorInputFocus?.(true);
      inst.setCursorMathTypeFocus?.(true);
      node.props.onSelectedChanged(inferredAnchorSelection);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const start = deepClone(inst.getContainerModel?.().cursorSelected);
      const end = bumpDeepestCharIndex(start, targetCharSpan);
      inst.setSelection(start, end);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const model = inst.getContainerModel?.();
      return {
        ok: true,
        inferredAnchorSelection,
        start,
        end,
        latex: inst.latexIoHandler?.getSelectedLatex?.("latex-latex", false) ?? "",
        json: inst.getSelectedJson?.() ?? "",
        cursorSelected: safe(model?.cursorSelected),
        extendedCursorSelected: safe(model?.extendedCursorSelected)
      };
    },
    {
      targetSelector: selector,
      targetAnchorSelection: anchorSelection,
      targetCharSpan: charSpan
    }
  );
}

export async function readPageSummary(page) {
  return page.evaluate(() => {
    const safeDescribe = (value, depth = 0) => {
      if (value === null) return { type: "null" };
      if (value === undefined) return { type: "undefined" };
      if (depth > 2) return { type: Array.isArray(value) ? "array" : typeof value };

      if (Array.isArray(value)) {
        return {
          type: "array",
          length: value.length,
          sample: value.slice(0, 3).map((item) => safeDescribe(item, depth + 1))
        };
      }

      if (typeof value === "object") {
        const keys = Object.keys(value).slice(0, 20);
        return {
          type: "object",
          keys,
          sample: Object.fromEntries(keys.slice(0, 8).map((key) => [key, safeDescribe(value[key], depth + 1)]))
        };
      }

      if (typeof value === "function") {
        return {
          type: "function",
          name: value.name,
          sourcePreview: Function.prototype.toString.call(value).slice(0, 240)
        };
      }

      if (typeof value === "string") {
        return {
          type: "string",
          length: value.length,
          preview: value.slice(0, 160)
        };
      }

      return {
        type: typeof value,
        value
      };
    };

    const tryParseJson = (input) => {
      try {
        return JSON.parse(input);
      } catch {
        return null;
      }
    };

    const mathGlobal = window.mathGlobal;
    const rawMathData = localStorage.getItem("math-data");
    const parsedMathData = rawMathData ? tryParseJson(rawMathData) : null;
    const commandCandidates = [];

    if (mathGlobal && typeof mathGlobal === "object") {
      for (const key of Object.keys(mathGlobal)) {
        const value = mathGlobal[key];
        if (typeof value === "function" && /(copy|latex|export|select|editor|command)/i.test(key)) {
          commandCandidates.push({
            key,
            sourcePreview: Function.prototype.toString.call(value).slice(0, 240)
          });
        }
      }
    }

    return {
      title: document.title,
      url: window.location.href,
      windowKeys: Object.keys(window).sort(),
      mathGlobalSummary: mathGlobal
        ? {
            typeof: typeof mathGlobal,
            keys: Object.keys(mathGlobal).sort(),
            sample: safeDescribe(mathGlobal)
          }
        : null,
      commandCandidates,
      mathDataSummary: rawMathData
        ? {
            rawLength: rawMathData.length,
            parsedShape: safeDescribe(parsedMathData)
          }
        : null,
      selectionState: {
        activeElement: document.activeElement
          ? {
              tagName: document.activeElement.tagName,
              className: document.activeElement.className,
              role: document.activeElement.getAttribute("role")
            }
          : null,
        selectionTextLength: window.getSelection()?.toString().length ?? 0
      }
    };
  });
}

export async function collectDomModelBridge(page, sampleBlockIds) {
  if (!sampleBlockIds?.length) {
    return null;
  }

  return page.evaluate((ids) => {
    const matches = [];
    const elements = Array.from(document.querySelectorAll("*")).slice(0, 4000);

    for (const element of elements) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
        continue;
      }

      const attributes = Array.from(element.getAttributeNames()).map((name) => ({
        name,
        value: element.getAttribute(name) ?? ""
      }));

      for (const blockId of ids) {
        const hit = attributes.find((attribute) => attribute.value.includes(blockId));
        if (hit) {
          matches.push({
            blockId,
            tagName: element.tagName,
            attribute: hit.name,
            valuePreview: hit.value.slice(0, 120)
          });
          break;
        }
      }

      if (matches.length >= 20) {
        break;
      }
    }

    return {
      searchedIds: ids,
      matches
    };
  }, sampleBlockIds);
}

export function buildRecommendation(report) {
  const hasDocumentModel = Boolean(
    report.documentModelSummary?.lineCount ||
      report.documentModelSummary?.mathContainerCount ||
      report.documentModelSummary?.compositeTypeCount
  );

  if (report.copyLatexButtonProbe?.clipboardText?.length) {
    return {
      strategy: "Promote the discovered command path into production",
      reason: "The direct baseline path produced clipboard output and can now be compared against injected calls.",
      nextStep: "Call the same runtime command directly and replace the menu-click path with it."
    };
  }

  if (hasDocumentModel) {
    return {
      strategy: "Use document API data as the primary integration surface",
      reason: "The active document endpoint exposes structured editor data without relying on rendered DOM nodes.",
      nextStep: "Map runtime selection state to a node in the document model, then keep DOM access only as a narrow fallback."
    };
  }

  if ((report.windowCandidates ?? []).length > 0) {
    return {
      strategy: "Investigate internal app globals first",
      reason: "Window-level candidates matching editor/state semantics were discovered.",
      nextStep: `Start by instrumenting ${(report.windowCandidates ?? []).slice(0, 5).join(", ")} from a browser console and map them to current LaTeX extraction needs.`
    };
  }

  return {
    strategy: "Keep DOM fallback, but isolate it",
    reason: "No stable non-DOM hook was discovered automatically in the first pass.",
    nextStep: "Refactor current DOM logic behind a dedicated fallback adapter and continue targeted runtime inspection."
  };
}

export async function writeArtifacts(name, report) {
  await ensureReportDir();

  const stem = `${name}-${timestampSlug()}`;
  const jsonPath = path.join(reportDir, `${stem}.json`);
  const mdPath = path.join(reportDir, `${stem}.md`);
  const recommendation = buildRecommendation(report);
  const markdown = [
    `# ${report.reportTitle ?? "Mathcha Analysis Summary"}`,
    "",
    `- URL: ${report.pageUrl}`,
    `- Title: ${report.pageTitle}`,
    `- Interesting window globals: ${report.windowCandidates?.length ?? 0}`,
    `- mathGlobal keys: ${report.mathGlobalSummary?.keys?.length ?? 0}`,
    `- Document lines: ${report.documentModelSummary?.lineCount ?? 0}`,
    `- Math containers: ${report.documentModelSummary?.mathContainerCount ?? 0}`,
    `- Composite types: ${Object.keys(report.documentModelSummary?.compositeTypeCount ?? {}).length}`,
    `- Interesting network requests: ${report.networkSummary?.interestingRequests?.length ?? 0}`,
    report.keyboardCopyResult ? `- Keyboard copy preview: ${report.keyboardCopyResult.preview ?? "[none]"}` : null,
    report.copyLatexButtonProbe?.buttonText ? `- Baseline menu button: ${report.copyLatexButtonProbe.buttonText}` : null,
    "",
    "## Recommendation",
    "",
    `- Strategy: ${recommendation.strategy}`,
    `- Why: ${recommendation.reason}`,
    `- Next step: ${recommendation.nextStep}`,
    ""
  ]
    .filter(Boolean)
    .join("\n");

  await fs.writeFile(jsonPath, JSON.stringify({ ...report, recommendation }, null, 2));
  await fs.writeFile(mdPath, markdown);

  return { jsonPath, mdPath };
}

export async function attemptDirectRuntimeInvocation(page) {
  return page.evaluate(async () => {
    const candidates = [];
    const seenCandidates = new Set();
    const visitedObjects = new Set();
    const queue = [];
    const wrapperTraces = [];
    const seenTraceObjects = new Set();

    const summarizeReturn = (value) => {
      if (typeof value === "string") {
        return {
          type: "string",
          length: value.length,
          preview: value.slice(0, 300)
        };
      }

      if (value && typeof value === "object") {
        return {
          type: Array.isArray(value) ? "array" : "object",
          keys: Object.keys(value).slice(0, 12)
        };
      }

      return {
        type: typeof value,
        value
      };
    };

    const summarizeObject = (value) => {
      if (!value || typeof value !== "object") {
        return { type: typeof value };
      }

      let keys = [];
      try {
        keys = Object.keys(value).slice(0, 20);
      } catch {
        keys = [];
      }

      return {
        constructorName: value.constructor?.name ?? null,
        keys
      };
    };

    const inspectCandidate = (value) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const latexIoHandler = value.getLatexIoHandler?.() ?? value.latexIoHandler ?? value.contextMenuHandler?.latexIoHandler ?? null;
      const controller = value.getController?.() ?? value.editorContainerController ?? null;
      const containerModel = value.getContainerModel?.() ?? null;

      const flags = {
        hasLatexIoHandler: Boolean(latexIoHandler?.getSelectedLatex),
        hasCopyPasteHandler: Boolean((value.getCopyPasteHandler?.() ?? value.copyPasteHandler)?.executeCopy),
        hasContextMenuLatexHandler: Boolean(value.contextMenuHandler?.latexIoHandler?.getSelectedLatex),
        hasRequestExportSelection: typeof value.requestExportSelection === "function",
        hasController: Boolean(controller?.getSelectionData),
        hasContainerModel: Boolean(containerModel),
        hasGetMathTypeHtmlElement: typeof value.getMathTypeHtmlElement === "function",
        hasGetSelectedJson: typeof value.getSelectedJson === "function"
      };

      const score =
        Number(flags.hasLatexIoHandler) * 4 +
        Number(flags.hasController) * 3 +
        Number(flags.hasContainerModel) * 2 +
        Number(flags.hasGetMathTypeHtmlElement) * 1 +
        Number(flags.hasCopyPasteHandler) * 1 +
        Number(flags.hasRequestExportSelection) * 1 +
        Number(flags.hasGetSelectedJson) * 1;

      if (score < 5) {
        return;
      }

      return {
        score,
        latexIoHandler,
        controller,
        containerModel,
        flags
      };
    };

    const unwrapRefs = (value) => {
      const unwrapped = [];
      if (!value || typeof value !== "object") {
        return unwrapped;
      }

      for (const key of ["getWrappedInstance", "docRef", "mathType", "mathTypeRef", "wrappedInstance", "target"]) {
        try {
          const next = key === "getWrappedInstance" ? value.getWrappedInstance?.() : value[key];
          if (next && typeof next === "object") {
            unwrapped.push({ key, value: next });
          }
        } catch {
          // Ignore getters that throw.
        }
      }

      return unwrapped;
    };

    const traceWrapper = (value, source) => {
      if (!value || typeof value !== "object" || seenTraceObjects.has(value)) {
        return;
      }

      seenTraceObjects.add(value);
      const chain = [{ source, summary: summarizeObject(value) }];
      let current = value;
      let depth = 0;

      while (current && typeof current === "object" && depth < 6) {
        let next = null;
        let step = null;

        for (const key of ["getWrappedInstance", "editorContainer", "docRef", "mathType", "mathTypeRef", "wrappedInstance", "target"]) {
          try {
            const candidate = key === "getWrappedInstance" ? current.getWrappedInstance?.() : current[key];
            if (candidate && typeof candidate === "object") {
              next = candidate;
              step = key;
              break;
            }
          } catch {
            // Ignore throwing getters.
          }
        }

        if (!next) {
          break;
        }

        chain.push({
          source: `${chain[chain.length - 1].source}.${step}`,
          summary: summarizeObject(next)
        });
        current = next;
        depth += 1;
      }

      const last = chain[chain.length - 1];
      wrapperTraces.push({
        origin: source,
        depth: chain.length,
        chain,
        finalLooksLikeEditor: Boolean(inspectCandidate(current))
      });

      if (current && typeof current === "object") {
        pushCandidate(current, last.source);
      }
    };

    const pushCandidate = (candidate, source) => {
      const inspected = inspectCandidate(candidate);
      if (!inspected || seenCandidates.has(candidate)) {
        return;
      }

      seenCandidates.add(candidate);
      candidates.push({
        source,
        score: inspected.score,
        ...inspected.flags,
        candidate
      });

      for (const ref of unwrapRefs(candidate)) {
        if (!seenCandidates.has(ref.value)) {
          pushCandidate(ref.value, `${source}.${ref.key}`);
        }
      }
    };

    const enqueue = (value, source, depth) => {
      if (!value || typeof value !== "object" || visitedObjects.has(value) || depth > 3) {
        return;
      }

      visitedObjects.add(value);
      queue.push({ value, source, depth });
    };

    const walkReactInstance = (instance, origin) => {
      const localQueue = [instance];
      let inspected = 0;

      while (localQueue.length > 0 && inspected < 400) {
        const current = localQueue.shift();
        inspected += 1;
        if (!current) continue;

        if (current._instance) {
          pushCandidate(current._instance, `${origin}._instance`);
          traceWrapper(current._instance, `${origin}._instance`);
        }
        if (current.stateNode) {
          pushCandidate(current.stateNode, `${origin}.stateNode`);
          traceWrapper(current.stateNode, `${origin}.stateNode`);
        }
        if (current.memoizedProps) {
          enqueue(current.memoizedProps, `${origin}.memoizedProps`, 0);
          traceWrapper(current.memoizedProps, `${origin}.memoizedProps`);
        }
        if (current.memoizedState) {
          enqueue(current.memoizedState, `${origin}.memoizedState`, 0);
        }
        if (current._currentElement?._owner) {
          localQueue.push(current._currentElement._owner);
        }
        if (current._renderedComponent) {
          localQueue.push(current._renderedComponent);
        }
        if (Array.isArray(current._renderedChildren)) {
          for (const child of current._renderedChildren) {
            localQueue.push(child);
          }
        } else if (current._renderedChildren && typeof current._renderedChildren === "object") {
          for (const child of Object.values(current._renderedChildren)) {
            localQueue.push(child);
          }
        }

        if (current.child) localQueue.push(current.child);
        if (current.sibling) localQueue.push(current.sibling);
        if (current.return) localQueue.push(current.return);
      }
    };

    const hostSelectors = ["math-type", "math-edit-container", "textarea", "math-diagram", "page", "body"];
    const hostElements = [];
    for (const selector of hostSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        hostElements.push(element);
        if (element.reactInstance && typeof element.reactInstance === "object") {
          pushCandidate(element.reactInstance, `${element.tagName}.reactInstance`);
          traceWrapper(element.reactInstance, `${element.tagName}.reactInstance`);
        }
      }
    }

    for (const element of hostElements.concat(Array.from(document.querySelectorAll("*")).slice(0, 400))) {
      for (const key of Object.getOwnPropertyNames(element)) {
        if (
          key.startsWith("__reactFiber$") ||
          key.startsWith("__reactContainer$") ||
          key.startsWith("__reactInternalInstance$")
        ) {
          walkReactInstance(element[key], `${element.tagName}.${key}`);
        }
        if (key.startsWith("__reactProps$")) {
          enqueue(element[key], "react-props", 0);
          traceWrapper(element[key], "react-props");
        }
      }
    }

    enqueue(window, "window-root", 0);
    enqueue(window.mathGlobal, "window.mathGlobal", 0);
    traceWrapper(window, "window-root");
    traceWrapper(window.mathGlobal, "window.mathGlobal");

    let inspected = 0;
    while (queue.length > 0 && inspected < 2500) {
      const entry = queue.shift();
      inspected += 1;
      const value = entry.value;

      if (inspectCandidate(value)) {
        pushCandidate(value, entry.source);
      }

      let propertyNames = [];
      try {
        propertyNames = Object.keys(value).slice(0, 40);
      } catch {
        propertyNames = [];
      }

      for (const ref of unwrapRefs(value)) {
        enqueue(ref.value, `${entry.source}.${ref.key}`, entry.depth + 1);
        traceWrapper(ref.value, `${entry.source}.${ref.key}`);
      }

      for (const propertyName of propertyNames) {
        let child;
        try {
          child = value[propertyName];
        } catch {
          child = null;
        }

        if (
          propertyName === "latexIoHandler" ||
          propertyName === "copyPasteHandler" ||
          propertyName === "contextMenuHandler" ||
          propertyName === "editorContainerController" ||
          propertyName === "docRef" ||
          propertyName === "mathType" ||
          propertyName === "mathTypeRef" ||
          propertyName === "wrappedInstance" ||
          propertyName === "target" ||
          propertyName === "props" ||
          propertyName === "state"
        ) {
          enqueue(child, `${entry.source}.${propertyName}`, entry.depth + 1);
        } else if (entry.depth < 2 && child && typeof child === "object") {
          enqueue(child, `${entry.source}.${propertyName}`, entry.depth + 1);
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    const attempts = [];

    for (const entry of candidates.slice(0, 12)) {
      const candidate = entry.candidate;
      const latexIoHandler = candidate.getLatexIoHandler?.() ?? candidate.latexIoHandler ?? candidate.contextMenuHandler?.latexIoHandler;
      const controller = candidate.getController?.() ?? candidate.editorContainerController;
      const containerModel = candidate.getContainerModel?.();
      const operations = [
        {
          name: "latexIoHandler.getSelectedLatex(latex-latex,false)",
          fn: () => latexIoHandler?.getSelectedLatex?.("latex-latex", false)
        },
        {
          name: "contextMenuHandler.latexIoHandler.getSelectedLatex(latex-latex,false)",
          fn: () => candidate.contextMenuHandler?.latexIoHandler?.getSelectedLatex?.("latex-latex", false)
        },
        {
          name: "copyPasteHandler.executeCopy()",
          fn: () => candidate.copyPasteHandler?.executeCopy?.()
        },
        {
          name: "requestExportSelection()",
          fn: () => candidate.requestExportSelection?.()
        },
        {
          name: "getSelectedJson()",
          fn: () => candidate.getSelectedJson?.()
        },
        {
          name: "controller.getSelectionData(containerModel,true)",
          fn: () => controller?.getSelectionData?.(containerModel, true)
        }
      ];

      const operationResults = [];
      for (const operation of operations) {
        try {
          const value = operation.fn();
          const awaitedValue = value && typeof value.then === "function" ? await value : value;
          operationResults.push({
            name: operation.name,
            ok: true,
            returnSummary: summarizeReturn(awaitedValue)
          });
        } catch (error) {
          operationResults.push({
            name: operation.name,
            ok: false,
            error: String(error)
          });
        }
      }

      attempts.push({
        source: entry.source,
        score: entry.score,
        hasLatexIoHandler: entry.hasLatexIoHandler,
        hasCopyPasteHandler: entry.hasCopyPasteHandler,
        hasContextMenuLatexHandler: entry.hasContextMenuLatexHandler,
        hasRequestExportSelection: entry.hasRequestExportSelection,
        hasController: entry.hasController,
        hasContainerModel: entry.hasContainerModel,
        hasGetMathTypeHtmlElement: entry.hasGetMathTypeHtmlElement,
        hasGetSelectedJson: entry.hasGetSelectedJson,
        operationResults
      });
    }

    return {
      candidateCount: candidates.length,
      inspectedObjectCount: inspected,
      attempts,
      wrapperTraces: wrapperTraces
        .sort((left, right) => Number(right.finalLooksLikeEditor) - Number(left.finalLooksLikeEditor) || right.depth - left.depth)
        .slice(0, 30)
    };
  });
}

export async function writeSnippetExtraction(name, ranges) {
  await ensureAnalysisDir();
  const candidatePaths = [path.resolve("random.js"), path.resolve("latex words/1.js")];
  let source = null;
  let sourcePath = null;

  for (const candidatePath of candidatePaths) {
    try {
      source = await fs.readFile(candidatePath, "utf8");
      sourcePath = candidatePath;
      break;
    } catch {
      // Try the next known bundle artifact.
    }
  }

  if (!source) {
    throw new Error(`Unable to locate snippet source. Checked: ${candidatePaths.join(", ")}`);
  }

  const lines = source.split(/\r?\n/);
  const payload = [];

  for (const range of ranges) {
    const slice = lines.slice(range.start - 1, range.end).map((line, index) => ({
      lineNumber: range.start + index,
      text: line
    }));
    payload.push({
      label: range.label,
      start: range.start,
      end: range.end,
      lines: slice
    });
  }

  const filePath = path.join(analysisDir, `${name}-${timestampSlug()}.json`);
  await fs.writeFile(filePath, JSON.stringify({ sourcePath, ranges: payload }, null, 2));
  return filePath;
}
