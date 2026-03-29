// ==UserScript==
// @name         Enhanced Mathcha.io - AI Integration
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  AI integration for Mathcha.io
// @author       Your name
// @match        https://*.mathcha.io/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        unsafeWindow
// ==/UserScript==
"use strict";
(() => {
  // src/script.ts
  (() => {
    "use strict";
    const SCRIPT_VERSION = "2.3";
    const PYODIDE_VERSION = "0.29.3";
    const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
    const PYODIDE_SCRIPT_URL = `${PYODIDE_INDEX_URL}pyodide.js`;
    const EXTENDED_PARSER_VERSION = "1.11.0";
    const ANTLR4_RUNTIME_VERSION = "4.13.2";
    const PERSIST_ROOT = "/mathcha-helper-cache";
    const PERSIST_ACTIVE_ROOT = `${PERSIST_ROOT}/active`;
    const PERSIST_ACTIVE_SITE_PACKAGES = `${PERSIST_ACTIVE_ROOT}/site-packages`;
    const PERSIST_STAGING_ROOT = `${PERSIST_ROOT}/staging`;
    const PERSIST_STAGING_SITE_PACKAGES = `${PERSIST_STAGING_ROOT}/site-packages`;
    const PERSIST_BACKUP_ROOT = `${PERSIST_ROOT}/backup`;
    const PERSIST_STATE_FILE = `${PERSIST_ROOT}/cache-state.json`;
    const pageWindow = unsafeWindow;
    const logLabel = `[Mathcha Helper v${SCRIPT_VERSION}]`;
    const log = (...args) => console.log(logLabel, ...args);
    const logError = (...args) => console.error(logLabel, ...args);
    function loadMathJax() {
      if (window.MathJax) return Promise.resolve();
      return new Promise((resolve, reject) => {
        window.MathJax = {
          tex: {
            inlineMath: [["$", "$"], ["\\(", "\\)"]],
            displayMath: [["$$", "$$"], ["\\[", "\\]"]]
          },
          svg: {
            fontCache: "global"
          }
        };
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load MathJax"));
        document.head.appendChild(script);
      });
    }
    const config = {
      aiShortcuts: {
        copyLatex: "'",
        analyze: ";",
        symbolab: ".",
        answer: "/",
        pasteFromLatex: ","
      },
      delay: {
        standard: 200,
        retry: [500, 1e3]
      },
      maxRetries: 2,
      aiServices: {
        claude: {
          name: "Claude AI",
          url: "https://claude.ai/new?q=%s"
        },
        chatgpt: {
          name: "ChatGPT",
          url: "https://chatgpt.com/?q=%s"
        },
        gemini: {
          name: "Google Gemini",
          url: "https://gemini.google.com/?q=%s"
        }
      }
    };
    const notify = /* @__PURE__ */ (() => {
      let current = null;
      return (message, isError = false) => {
        current?.remove();
        const toast = document.createElement("div");
        Object.assign(toast.style, {
          position: "fixed",
          bottom: "20px",
          right: "20px",
          padding: "8px 16px",
          borderRadius: "4px",
          backgroundColor: isError ? "rgba(200,0,0,0.8)" : "rgba(0,0,0,0.7)",
          color: "#fff",
          zIndex: "9999"
        });
        toast.textContent = message;
        document.body.appendChild(toast);
        current = toast;
        setTimeout(() => toast.remove(), 2e3);
      };
    })();
    const createTooltip = () => {
      const aiTooltip2 = document.createElement("div");
      aiTooltip2.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 5px;
      padding: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      display: none;
    `;
      aiTooltip2.innerHTML = `
      <div style="margin-bottom: 8px; font-weight: bold;">AI Shortcuts (Ctrl+Alt+Key)</div>
      <div style="margin: 4px 0;">
        <kbd>${config.aiShortcuts.copyLatex}</kbd> - Copy LaTeX
      </div>
      <div style="margin: 4px 0;">
        <kbd>${config.aiShortcuts.analyze}</kbd> - Analyze with AI
      </div>
      <div style="margin: 4px 0;">
        <kbd>${config.aiShortcuts.symbolab}</kbd> - Open in Symbolab
      </div>
      <div style="margin: 4px 0;">
        <kbd>${config.aiShortcuts.answer}</kbd> - Solve with Python
      </div>
      <div style="margin: 4px 0;">
        <kbd>${config.aiShortcuts.pasteFromLatex}</kbd> - Paste From LaTeX
      </div>
    `;
      document.body.appendChild(aiTooltip2);
      return aiTooltip2;
    };
    const mathcha = {
      getLatexIoHandler(editor) {
        return editor?.latexIoHandler ?? null;
      },
      summarizeValue(value, depth = 0) {
        if (value === void 0) return "[undefined]";
        if (value === null) return null;
        if (depth > 3) return typeof value;
        if (Array.isArray(value)) return value.slice(0, 8).map((item) => this.summarizeValue(item, depth + 1));
        if (typeof value === "object") {
          const out = {};
          for (const key of Object.keys(value).slice(0, 20)) {
            out[key] = this.summarizeValue(value[key], depth + 1);
          }
          return out;
        }
        return value;
      },
      logRuntime(step, details) {
        log(`[runtime] ${step}`, details ?? {});
      },
      getEditorInstance() {
        const mathTypeElement = document.querySelector("math-type");
        this.logRuntime("getEditorInstance:query", {
          foundMathType: Boolean(mathTypeElement),
          hasReactInstance: Boolean(mathTypeElement && "reactInstance" in mathTypeElement)
        });
        const editor = mathTypeElement?.reactInstance;
        if (!editor || typeof editor !== "object") {
          this.logRuntime("getEditorInstance:missing");
          return null;
        }
        this.logRuntime("getEditorInstance:resolved", {
          constructorName: editor.constructor?.name ?? null,
          keys: Object.keys(editor).slice(0, 20)
        });
        return editor;
      },
      normalizeImportLatex(text) {
        const trimmed = text.trim();
        if (/^\$\$[\s\S]*\$\$$/.test(trimmed)) {
          return trimmed.slice(2, -2).trim();
        }
        if (/^\$[\s\S]*\$/.test(trimmed)) {
          return trimmed.slice(1, -1).trim();
        }
        return trimmed;
      },
      getImportDialog() {
        const root = document.querySelector(".import-latex");
        if (!(root instanceof HTMLElement)) {
          this.logRuntime("getImportDialog:missing-root");
          return null;
        }
        const textarea = root.querySelector("textarea");
        const okButton = root.querySelector("button.ok");
        if (!(textarea instanceof HTMLTextAreaElement) || !(okButton instanceof HTMLButtonElement)) {
          this.logRuntime("getImportDialog:missing-controls", {
            hasTextarea: textarea instanceof HTMLTextAreaElement,
            hasOkButton: okButton instanceof HTMLButtonElement
          });
          return null;
        }
        return { root, textarea, okButton };
      },
      getImportDialogElement(latexIoHandler) {
        const element = latexIoHandler?.renderImportLatexBox?.() ?? null;
        if (!element) {
          this.logRuntime("getImportDialogElement:missing");
          return null;
        }
        this.logRuntime("getImportDialogElement:resolved", {
          typeName: element.type?.name ?? null,
          hasParseLatex: typeof element.type?.prototype?.parseLatex === "function",
          forMathMode: element.props?.forMathMode ?? null
        });
        return element;
      },
      parseLatexWithRuntime(dialogElement, latex, options) {
        const dialogType = dialogElement?.type;
        const parseLatex = dialogType?.prototype?.parseLatex;
        if (typeof parseLatex !== "function") {
          throw new Error("Mathcha runtime parser is unavailable");
        }
        const forceMathMode = options?.forceMathMode ?? false;
        const parserLike = {
          props: {
            ...dialogElement?.props ?? {},
            ...forceMathMode ? { forMathMode: true } : {}
          },
          wrapInMathContainer: dialogType?.prototype?.wrapInMathContainer
        };
        const parsed = parseLatex.call(parserLike, latex);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("Mathcha parser returned no content");
        }
        this.logRuntime("parseLatexWithRuntime:parsed", {
          forMathMode: parserLike.props.forMathMode ?? null,
          parsedLength: parsed.length
        });
        return parsed;
      },
      buildImportPayload(dialogElement, parsed, options) {
        const forceMathMode = options?.forceMathMode ?? false;
        if (forceMathMode || dialogElement?.props?.forMathMode) {
          const mathLines = parsed[0]?.blocks?.[0]?.elements?.mathValue?.lines;
          if (!Array.isArray(mathLines) || mathLines.length === 0) {
            throw new Error("Mathcha runtime parser did not produce math-mode lines");
          }
          return mathLines;
        }
        return parsed;
      },
      getEditorModelFingerprint(editor) {
        const safeStringify = (value) => {
          const seen = /* @__PURE__ */ new WeakSet();
          return JSON.stringify(value, (_key, currentValue) => {
            if (typeof currentValue === "object" && currentValue !== null) {
              if (seen.has(currentValue)) return "[circular]";
              seen.add(currentValue);
            }
            return currentValue;
          });
        };
        return safeStringify({
          mainModel: editor?.state?.mainModel ?? null,
          cursorSelected: editor?.getContainerModel?.()?.cursorSelected ?? null,
          extendedCursorSelected: editor?.getContainerModel?.()?.extendedCursorSelected ?? null
        });
      },
      async extractSelectedLatexForSolver() {
        this.logRuntime("extractSelectedLatexForSolver:start");
        const latex = await this.tryRuntimeLatexExtraction();
        if (!latex) {
          throw new Error("No runtime LaTeX selection available for solver");
        }
        const normalizedLatex = this.normalizeLatexForSolver(latex);
        this.logRuntime("extractSelectedLatexForSolver:success", {
          latexPreview: latex.slice(0, 120),
          normalizedPreview: normalizedLatex.slice(0, 120)
        });
        return normalizedLatex;
      },
      normalizeLatexForSolver(latex) {
        let normalized = latex.trim();
        normalized = this.normalizeImportLatex(normalized);
        normalized = normalized.replace(/^\\displaystyle\s*/, "").trim();
        const equationIndex = normalized.indexOf("=");
        if (equationIndex >= 0) {
          normalized = normalized.slice(0, equationIndex).trim();
        }
        this.logRuntime("normalizeLatexForSolver:complete", {
          inputPreview: latex.slice(0, 120),
          outputPreview: normalized.slice(0, 120)
        });
        if (!normalized) {
          throw new Error("Selected LaTeX is empty after solver normalization");
        }
        return normalized;
      },
      getInsertionTargetSelection(editor) {
        const containerModel = editor?.getContainerModel?.();
        const insertionTarget = containerModel?.extendedCursorSelected ?? containerModel?.cursorSelected ?? null;
        this.logRuntime("getInsertionTargetSelection:resolved", {
          hasCursorSelected: Boolean(containerModel?.cursorSelected),
          hasExtendedCursorSelected: Boolean(containerModel?.extendedCursorSelected),
          insertionTarget: insertionTarget ? this.summarizeValue(insertionTarget) : null
        });
        return insertionTarget;
      },
      async insertMathAtSelectionEnd(latex, options) {
        const forceMathMode = options?.forceMathMode ?? true;
        const editor = this.getEditorInstance();
        const latexIoHandler = this.getLatexIoHandler(editor);
        if (!editor || !latexIoHandler || typeof latexIoHandler.showImportFromLatex !== "function") {
          throw new Error("Mathcha insert handler is unavailable");
        }
        const insertionTarget = this.getInsertionTargetSelection(editor);
        if (!insertionTarget || typeof editor.setSelected !== "function") {
          throw new Error("Unable to resolve insertion point from current selection");
        }
        editor.setCursorInputFocus?.(true);
        editor.setCursorMathTypeFocus?.(true);
        editor.setSelected(insertionTarget);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const beforeModel = this.getEditorModelFingerprint(editor);
        latexIoHandler.showImportFromLatex();
        const dialogElement = this.getImportDialogElement(latexIoHandler);
        if (!dialogElement) {
          throw new Error("Mathcha import runtime dialog element is unavailable");
        }
        const parsed = this.parseLatexWithRuntime(dialogElement, latex, { forceMathMode });
        const payload = this.buildImportPayload(dialogElement, parsed, { forceMathMode });
        this.logRuntime("insertMathAtSelectionEnd:parsed", {
          latexPreview: latex.slice(0, 120),
          effectiveMathMode: forceMathMode || dialogElement.props?.forMathMode || false,
          payloadKind: Array.isArray(payload) ? "lines" : typeof payload
        });
        if (typeof latexIoHandler.onSuccessfulParse !== "function") {
          throw new Error("Mathcha import apply handler is unavailable");
        }
        latexIoHandler.onSuccessfulParse(payload);
        await new Promise((resolve) => setTimeout(resolve, config.delay.standard * 2));
        const afterModel = this.getEditorModelFingerprint(editor);
        if (beforeModel === afterModel) {
          throw new Error("Mathcha insert did not change the editor");
        }
        this.logRuntime("insertMathAtSelectionEnd:complete", {
          changed: beforeModel !== afterModel,
          dialogStillOpen: Boolean(document.querySelector(".import-latex"))
        });
      },
      async importFromLatexClipboard() {
        const rawClipboardText = await navigator.clipboard.readText();
        if (!rawClipboardText.trim()) {
          throw new Error("Clipboard is empty");
        }
        const normalizedLatex = this.normalizeImportLatex(rawClipboardText);
        const forceMathMode = true;
        this.logRuntime("importFromLatexClipboard:start", {
          rawPreview: rawClipboardText.slice(0, 120),
          normalizedPreview: normalizedLatex.slice(0, 120),
          forceMathMode
        });
        const editor = this.getEditorInstance();
        const latexIoHandler = this.getLatexIoHandler(editor);
        if (typeof latexIoHandler?.showImportFromLatex !== "function") {
          throw new Error("Mathcha import handler is unavailable");
        }
        editor?.setCursorInputFocus?.(true);
        editor?.setCursorMathTypeFocus?.(true);
        const beforeModel = this.getEditorModelFingerprint(editor);
        try {
          latexIoHandler.showImportFromLatex();
          const dialogElement = this.getImportDialogElement(latexIoHandler);
          if (!dialogElement) {
            throw new Error("Import runtime dialog element is unavailable");
          }
          const parsed = this.parseLatexWithRuntime(dialogElement, normalizedLatex, { forceMathMode });
          const payload = this.buildImportPayload(dialogElement, parsed, { forceMathMode });
          this.logRuntime("importFromLatexClipboard:direct-parse", {
            forMathMode: dialogElement.props?.forMathMode ?? null,
            effectiveMathMode: forceMathMode || dialogElement.props?.forMathMode || false,
            payloadKind: Array.isArray(payload) ? "lines" : typeof payload
          });
          if (typeof latexIoHandler.onSuccessfulParse !== "function") {
            throw new Error("Mathcha import apply handler is unavailable");
          }
          latexIoHandler.onSuccessfulParse(payload);
        } catch (directError) {
          this.logRuntime("importFromLatexClipboard:direct-failed", {
            error: directError instanceof Error ? directError.message : String(directError)
          });
          latexIoHandler.showImportFromLatex();
          await new Promise((resolve) => setTimeout(resolve, config.delay.standard));
          const dialog = this.getImportDialog();
          if (!dialog) {
            throw new Error("Import dialog did not open");
          }
          dialog.textarea.focus();
          dialog.textarea.value = normalizedLatex;
          dialog.textarea.dispatchEvent(new Event("input", { bubbles: true }));
          dialog.textarea.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, config.delay.standard * 4));
          this.logRuntime("importFromLatexClipboard:fallback-dialog-ready", {
            isTextModeSelected: editor?.getContainerModel?.()?.isTextModeSelected?.() ?? null,
            okDisabled: dialog.okButton.disabled,
            textareaLength: dialog.textarea.value.length
          });
          if (dialog.okButton.disabled) {
            throw new Error("Mathcha could not parse clipboard LaTeX");
          }
          dialog.okButton.click();
        }
        await new Promise((resolve) => setTimeout(resolve, config.delay.standard * 2));
        const afterModel = this.getEditorModelFingerprint(editor);
        const changed = beforeModel !== afterModel;
        this.logRuntime("importFromLatexClipboard:complete", {
          changed,
          dialogStillOpen: Boolean(document.querySelector(".import-latex"))
        });
        if (!changed) {
          throw new Error("Mathcha import did not change the editor");
        }
        return normalizedLatex;
      },
      cloneSelection(value) {
        return JSON.parse(JSON.stringify(value));
      },
      bumpDeepestCharIndex(selection, delta) {
        const clone = this.cloneSelection(selection);
        let cursor = clone;
        while (cursor && typeof cursor === "object" && cursor.selected && typeof cursor.selected === "object") {
          const child = cursor.selected;
          if (typeof child.charIndex === "number" && child.key === void 0) {
            child.charIndex += delta;
            return clone;
          }
          cursor = child;
        }
        if (cursor && typeof cursor.charIndex === "number") {
          cursor.charIndex += delta;
        }
        return clone;
      },
      inferCompositeAnchorSelection(compositeNode) {
        const elementKeys = Object.keys(compositeNode.reactInstance?.props?.data?.elements ?? {});
        const key = elementKeys[0];
        if (!key) {
          this.logRuntime("inferCompositeAnchorSelection:no-key", {
            tagName: compositeNode.tagName,
            className: compositeNode.className
          });
          return null;
        }
        this.logRuntime("inferCompositeAnchorSelection:resolved", {
          tagName: compositeNode.tagName,
          className: compositeNode.className,
          key,
          elementKeys
        });
        return {
          key,
          selected: { lineIndex: 0, charIndex: 0 }
        };
      },
      findCompositeSelectionNode() {
        const selection = window.getSelection();
        const candidates = [];
        const pushCandidate = (element) => {
          if (!element) return;
          candidates.push(element);
        };
        if (selection?.rangeCount) {
          const range = selection.getRangeAt(0);
          pushCandidate(range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement);
          const rect = range.getBoundingClientRect();
          if (rect.width || rect.height) {
            pushCandidate(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }
        }
        pushCandidate(document.activeElement);
        pushCandidate(document.querySelector("compositeblock:hover"));
        this.logRuntime("findCompositeSelectionNode:candidates", {
          count: candidates.length,
          candidates: candidates.map((candidate) => ({
            tagName: candidate.tagName,
            className: candidate instanceof HTMLElement ? candidate.className : ""
          }))
        });
        for (const candidate of candidates) {
          const compositeNode = candidate?.closest?.("compositeblock");
          if (compositeNode instanceof HTMLElement && typeof compositeNode.reactInstance?.props?.onSelectedChanged === "function") {
            this.logRuntime("findCompositeSelectionNode:resolved", {
              tagName: compositeNode.tagName,
              className: compositeNode.className,
              dataText: compositeNode.reactInstance?.props?.data?.text ?? null
            });
            return compositeNode;
          }
        }
        this.logRuntime("findCompositeSelectionNode:missing");
        return null;
      },
      async tryRuntimeLatexExtraction() {
        this.logRuntime("tryRuntimeLatexExtraction:start");
        const editor = this.getEditorInstance();
        const latexIoHandler = this.getLatexIoHandler(editor);
        if (typeof latexIoHandler?.getSelectedLatex !== "function") {
          this.logRuntime("tryRuntimeLatexExtraction:no-latex-handler");
          return null;
        }
        const directLatex = latexIoHandler.getSelectedLatex("latex-latex", false)?.trim();
        if (directLatex) {
          this.logRuntime("tryRuntimeLatexExtraction:direct-hit", {
            latexPreview: directLatex.slice(0, 120)
          });
          return directLatex;
        }
        this.logRuntime("tryRuntimeLatexExtraction:direct-empty");
        const compositeNode = this.findCompositeSelectionNode();
        const onSelectedChanged = compositeNode?.reactInstance?.props?.onSelectedChanged;
        const anchorSelection = compositeNode ? this.inferCompositeAnchorSelection(compositeNode) : null;
        if (!editor || typeof onSelectedChanged !== "function" || !anchorSelection || typeof editor.setSelection !== "function") {
          this.logRuntime("tryRuntimeLatexExtraction:node-path-unavailable", {
            hasEditor: Boolean(editor),
            hasCompositeNode: Boolean(compositeNode),
            hasOnSelectedChanged: typeof onSelectedChanged === "function",
            hasAnchorSelection: Boolean(anchorSelection),
            hasSetSelection: typeof editor?.setSelection === "function"
          });
          return null;
        }
        try {
          editor.clearSelection?.();
          editor.setCursorInputFocus?.(true);
          editor.setCursorMathTypeFocus?.(true);
          this.logRuntime("tryRuntimeLatexExtraction:node-anchor", {
            anchorSelection: this.summarizeValue(anchorSelection)
          });
          onSelectedChanged(anchorSelection);
          await new Promise((resolve) => setTimeout(resolve, 30));
          const start = editor.getContainerModel?.()?.cursorSelected;
          if (!start) {
            this.logRuntime("tryRuntimeLatexExtraction:no-start-selection");
            return null;
          }
          const end = this.bumpDeepestCharIndex(start, 1);
          this.logRuntime("tryRuntimeLatexExtraction:setSelection", {
            start: this.summarizeValue(start),
            end: this.summarizeValue(end)
          });
          editor.setSelection(start, end);
          await new Promise((resolve) => setTimeout(resolve, 30));
          const replayedLatex = latexIoHandler.getSelectedLatex("latex-latex", false)?.trim();
          this.logRuntime("tryRuntimeLatexExtraction:node-result", {
            latexPreview: replayedLatex?.slice(0, 120) ?? "",
            selectedJsonPreview: editor.getSelectedJson?.()?.slice(0, 220) ?? ""
          });
          return replayedLatex || null;
        } catch (error) {
          log("Runtime LaTeX extraction failed, falling back to DOM path", error);
          return null;
        }
      },
      findLatexButton() {
        const strategies = [
          () => document.querySelector("ct-item.clipboard.copy-latex"),
          () => document.querySelector(
            "editor-container math-type context-menu-container ct-menus ct-item.clipboard.copy-latex"
          ),
          () => {
            const menus = document.getElementsByTagName("ct-menus");
            for (const menu of menus) {
              const button = menu.querySelector("ct-item.clipboard.copy-latex");
              if (button) return button;
            }
            return null;
          }
        ];
        for (const strategy of strategies) {
          const button = strategy();
          if (button) return button;
        }
        return null;
      },
      async getLatex() {
        const button = this.findLatexButton();
        if (button instanceof HTMLElement) {
          button.click();
          return true;
        }
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const element = range.startContainer.parentElement;
        if (!element) return false;
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.right,
          clientY: rect.top
        });
        element.dispatchEvent(event);
        await new Promise((resolve) => setTimeout(resolve, config.delay.standard));
        const menuButton = this.findLatexButton();
        if (!(menuButton instanceof HTMLElement)) return false;
        menuButton.click();
        return true;
      },
      async copyToClipboard() {
        for (let attempt = 0; attempt < config.maxRetries + 1; attempt += 1) {
          try {
            this.logRuntime("copyToClipboard:attempt", { attempt });
            const runtimeLatex = await this.tryRuntimeLatexExtraction();
            if (runtimeLatex) {
              this.logRuntime("copyToClipboard:using-runtime", {
                latexPreview: runtimeLatex.slice(0, 120)
              });
              await navigator.clipboard.writeText(runtimeLatex);
              return runtimeLatex;
            }
            this.logRuntime("copyToClipboard:fallback-dom", { attempt });
            const success = await this.getLatex();
            if (!success) throw new Error("Failed to find LaTeX button");
            await new Promise((resolve) => setTimeout(resolve, config.delay.standard));
            const text = await navigator.clipboard.readText();
            if (!text) throw new Error("Clipboard is empty");
            this.logRuntime("copyToClipboard:dom-success", {
              latexPreview: text.slice(0, 120)
            });
            return text;
          } catch (error) {
            this.logRuntime("copyToClipboard:error", {
              attempt,
              error: error instanceof Error ? error.message : String(error)
            });
            if (attempt === config.maxRetries) {
              const message = error instanceof Error ? error.message : "Unknown error";
              notify(`Copy failed: ${message}`, true);
              throw error;
            }
            notify(`Copy attempt ${attempt + 1} failed, retrying...`, true);
            await new Promise((resolve) => setTimeout(resolve, config.delay.retry[attempt]));
          }
        }
        throw new Error("Unreachable");
      }
    };
    const services = {
      openAiService(latex, serviceKey) {
        const service = config.aiServices[serviceKey];
        if (!service) {
          notify("Invalid AI service selected", true);
          return;
        }
        const dialog = document.createElement("div");
        const overlay = document.createElement("div");
        Object.assign(dialog.style, {
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          backgroundColor: "#fff",
          padding: "20px",
          borderRadius: "8px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
          zIndex: "10000",
          width: "90%",
          maxWidth: "500px"
        });
        Object.assign(overlay.style, {
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: "9999"
        });
        const serviceSelector = document.createElement("select");
        Object.assign(serviceSelector.style, {
          width: "100%",
          padding: "8px",
          marginBottom: "10px",
          borderRadius: "4px",
          border: "1px solid #ccc"
        });
        Object.entries(config.aiServices).forEach(([key, selectedService]) => {
          const option = document.createElement("option");
          option.value = key;
          option.textContent = selectedService.name;
          if (key === serviceKey) option.selected = true;
          serviceSelector.appendChild(option);
        });
        const textarea = document.createElement("textarea");
        Object.assign(textarea.style, {
          width: "100%",
          height: "150px",
          marginBottom: "10px",
          padding: "8px",
          borderRadius: "4px",
          border: "1px solid #ccc"
        });
        textarea.value = GM_getValue("lastPrompt", "Enter your prompt here.");
        const buttons = document.createElement("div");
        buttons.style.textAlign = "right";
        const submit = document.createElement("button");
        submit.textContent = "Send to AI";
        Object.assign(submit.style, {
          padding: "8px 16px",
          marginLeft: "10px",
          backgroundColor: "#4CAF50",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer"
        });
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        Object.assign(cancel.style, {
          padding: "8px 16px",
          backgroundColor: "#ddd",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer"
        });
        const cleanup = () => {
          dialog.remove();
          overlay.remove();
        };
        submit.onclick = () => {
          const selectedService = config.aiServices[serviceSelector.value];
          const prompt = textarea.value.trim();
          GM_setValue("lastPrompt", prompt);
          GM_setValue("lastAiService", serviceSelector.value);
          const url = selectedService.url.replace("%s", encodeURIComponent(`${prompt}

${latex}`));
          GM_openInTab(url, { active: true });
          cleanup();
        };
        cancel.onclick = cleanup;
        textarea.onkeydown = (event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit.click();
          }
          if (event.key === "Escape") {
            cleanup();
          }
        };
        dialog.append(serviceSelector, textarea, buttons);
        buttons.append(cancel, submit);
        document.body.append(overlay, dialog);
        textarea.focus();
        textarea.select();
      },
      symbolab(latex) {
        const cleaned = latex.replace(/\$/g, "").trim();
        GM_openInTab(`https://www.symbolab.com/solver/step-by-step/${encodeURIComponent(cleaned)}`, {
          active: true
        });
      }
    };
    const pythonRuntime = /* @__PURE__ */ (() => {
      let pyodidePromise = null;
      let scriptLoadPromise = null;
      let solverPromise = null;
      let persistentFsPromise = null;
      const syncFs = async (pyodide, populate) => {
        const fs = pyodide.FS;
        await new Promise((resolve, reject) => {
          fs.syncfs(populate, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      };
      const ensurePersistentFs = async (pyodide) => {
        if (!persistentFsPromise) {
          persistentFsPromise = (async () => {
            const fs = pyodide.FS;
            if (!fs.analyzePath(PERSIST_ROOT).exists) {
              fs.mkdir(PERSIST_ROOT);
            }
            for (const dir of [PERSIST_ACTIVE_ROOT, PERSIST_STAGING_ROOT, PERSIST_BACKUP_ROOT]) {
              if (!fs.analyzePath(dir).exists) {
                fs.mkdir(dir);
              }
            }
            for (const dir of [PERSIST_ACTIVE_SITE_PACKAGES, PERSIST_STAGING_SITE_PACKAGES]) {
              if (!fs.analyzePath(dir).exists) {
                fs.mkdir(dir);
              }
            }
            try {
              fs.mount(fs.filesystems.IDBFS, { root: "." }, PERSIST_ROOT);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (!message.includes("already mounted")) {
                throw error;
              }
            }
            log("Syncing persistent Python cache from IndexedDB");
            await syncFs(pyodide, true);
          })().catch((error) => {
            persistentFsPromise = null;
            throw error;
          });
        }
        return persistentFsPromise;
      };
      const readCacheState = async (pyodide) => {
        const fs = pyodide.FS;
        if (!fs.analyzePath(PERSIST_STATE_FILE).exists) {
          return { status: "empty" };
        }
        try {
          return JSON.parse(fs.readFile(PERSIST_STATE_FILE, { encoding: "utf8" }));
        } catch {
          return { status: "broken" };
        }
      };
      const writeCacheState = async (pyodide, state) => {
        const fs = pyodide.FS;
        fs.writeFile(PERSIST_STATE_FILE, JSON.stringify(state));
        await syncFs(pyodide, false);
      };
      const ensurePersistentImports = async (pyodide) => {
        await pyodide.runPythonAsync(`
import importlib
import sys

cache_path = "${PERSIST_ACTIVE_SITE_PACKAGES}"
if cache_path not in sys.path:
    sys.path.insert(0, cache_path)
importlib.invalidate_caches()
`);
      };
      const suspendActiveCacheImports = async (pyodide) => {
        await pyodide.runPythonAsync(`
import importlib
import sys

active_cache_path = "${PERSIST_ACTIVE_SITE_PACKAGES}"

while active_cache_path in sys.path:
    sys.path.remove(active_cache_path)

for module_name in (
    "latex2sympy2_extended",
    "latex2sympy2_extended.antlr_parser",
    "latex2sympy2_extended.latex2sympy2",
    "antlr4",
):
    sys.modules.pop(module_name, None)

importlib.invalidate_caches()
`);
      };
      const restoreActiveCacheImports = async (pyodide) => {
        await pyodide.runPythonAsync(`
import importlib
import sys

active_cache_path = "${PERSIST_ACTIVE_SITE_PACKAGES}"

if active_cache_path not in sys.path:
    sys.path.insert(0, active_cache_path)

importlib.invalidate_caches()
`);
      };
      const validateRuntimeSolverSmokeTest = async (pyodide) => {
        const result = await pyodide.runPythonAsync(`
import json

try:
    solver_result = mathcha_solve_latex(r"2^{5} + 2^{4} + 2^{2} + 2^{0}")
    assert solver_result == "53"
    validation_result = json.dumps({"ok": True})
except Exception as error:
    validation_result = json.dumps({"ok": False, "error": repr(error)})

validation_result
`);
        return JSON.parse(String(result));
      };
      const hasPersistedSolverFiles = (pyodide) => {
        const fs = pyodide.FS;
        const requiredPaths = [
          `${PERSIST_ACTIVE_SITE_PACKAGES}/latex2sympy2_extended`,
          `${PERSIST_ACTIVE_SITE_PACKAGES}/antlr4`,
          `${PERSIST_ACTIVE_SITE_PACKAGES}/antlr4_python3_runtime-${ANTLR4_RUNTIME_VERSION}.dist-info`,
          `${PERSIST_ACTIVE_SITE_PACKAGES}/latex2sympy2_extended-${EXTENDED_PARSER_VERSION}.dist-info`
        ];
        return requiredPaths.every((path) => fs.analyzePath(path).exists);
      };
      const validatePersistedSolver = async (pyodide) => {
        const result = await pyodide.runPythonAsync(`
import importlib
import importlib.metadata
import importlib.util
import json
import sys

for module_name in (
    "latex2sympy2_extended",
    "latex2sympy2_extended.antlr_parser",
    "latex2sympy2_extended.latex2sympy2",
    "antlr4",
):
    sys.modules.pop(module_name, None)

importlib.invalidate_caches()

try:
    assert importlib.util.find_spec("latex2sympy2_extended")
    assert importlib.util.find_spec("antlr4")
    assert importlib.metadata.version("antlr4-python3-runtime") == "${ANTLR4_RUNTIME_VERSION}"
    assert importlib.metadata.version("latex2sympy2-extended") == "${EXTENDED_PARSER_VERSION}"
    from latex2sympy2_extended import latex2sympy
    from sympy import simplify, latex
    import antlr4
    expr = latex2sympy(r"2^{5} + 2^{4} + 2^{2} + 2^{0}")
    result = latex(simplify(expr.doit().doit()))
    assert result == "53"
    validation_result = json.dumps({"ok": True})
except Exception as error:
    validation_result = json.dumps({"ok": False, "error": repr(error)})

validation_result
`);
        return JSON.parse(String(result));
      };
      const clearStagingSolver = async (pyodide) => {
        await pyodide.runPythonAsync(`
import pathlib
import shutil

for root_path_str in ("${PERSIST_STAGING_SITE_PACKAGES}", "${PERSIST_BACKUP_ROOT}"):
    root_path = pathlib.Path(root_path_str)
    root_path.mkdir(parents=True, exist_ok=True)
    for child in list(root_path.iterdir()):
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
`);
      };
      const stageInstalledSolver = async (pyodide) => {
        await pyodide.runPythonAsync(`
import site
import pathlib
import shutil

site_packages_root = pathlib.Path(site.getsitepackages()[0])
active_root = pathlib.Path("${PERSIST_ACTIVE_ROOT}")
staging_root = pathlib.Path("${PERSIST_STAGING_ROOT}")
backup_root = pathlib.Path("${PERSIST_BACKUP_ROOT}")
active_site_packages = pathlib.Path("${PERSIST_ACTIVE_SITE_PACKAGES}")
staging_site_packages = pathlib.Path("${PERSIST_STAGING_SITE_PACKAGES}")

for root in (active_root, staging_root, backup_root, active_site_packages, staging_site_packages):
    root.mkdir(parents=True, exist_ok=True)

for child in list(staging_site_packages.iterdir()):
    if child.is_dir():
        shutil.rmtree(child)
    else:
        child.unlink()

for package_dir_name in ("latex2sympy2_extended", "antlr4"):
    source_path = site_packages_root / package_dir_name
    if not source_path.exists():
        raise ImportError(f"Cannot find installed package directory: {package_dir_name}")

    destination_path = staging_site_packages / package_dir_name
    if destination_path.exists():
        shutil.rmtree(destination_path)
    shutil.copytree(source_path, destination_path)

for metadata_dir in (
    site_packages_root / "antlr4_python3_runtime-${ANTLR4_RUNTIME_VERSION}.dist-info",
    site_packages_root / "latex2sympy2_extended-${EXTENDED_PARSER_VERSION}.dist-info",
):
    if metadata_dir.exists():
        destination_path = staging_site_packages / metadata_dir.name
        if destination_path.exists():
            shutil.rmtree(destination_path)
        shutil.copytree(metadata_dir, destination_path)
`);
      };
      const promoteStagedSolver = async (pyodide) => {
        await pyodide.runPythonAsync(`
import pathlib
import shutil

backup_root = pathlib.Path("${PERSIST_BACKUP_ROOT}")
active_site_packages = pathlib.Path("${PERSIST_ACTIVE_SITE_PACKAGES}")
staging_site_packages = pathlib.Path("${PERSIST_STAGING_SITE_PACKAGES}")

for root in (backup_root, active_site_packages, staging_site_packages):
    root.mkdir(parents=True, exist_ok=True)

for child in list(backup_root.iterdir()):
    if child.is_dir():
        shutil.rmtree(child)
    else:
        child.unlink()

for child in list(active_site_packages.iterdir()):
    shutil.move(str(child), backup_root / child.name)

for child in list(staging_site_packages.iterdir()):
    shutil.move(str(child), active_site_packages / child.name)

for child in list(backup_root.iterdir()):
    if child.is_dir():
        shutil.rmtree(child)
    else:
        child.unlink()
`);
        await writeCacheState(pyodide, { status: "ready", version: SCRIPT_VERSION });
        log("Saving persistent Python cache to IndexedDB");
      };
      const validateStagedSolver = async (pyodide) => {
        const result = await pyodide.runPythonAsync(`
import importlib
import importlib.metadata
import importlib.util
import json
import sys

active_cache_path = "${PERSIST_ACTIVE_SITE_PACKAGES}"
staging_cache_path = "${PERSIST_STAGING_SITE_PACKAGES}"

while active_cache_path in sys.path:
    sys.path.remove(active_cache_path)
if staging_cache_path not in sys.path:
    sys.path.insert(0, staging_cache_path)

for module_name in (
    "latex2sympy2_extended",
    "latex2sympy2_extended.antlr_parser",
    "latex2sympy2_extended.latex2sympy2",
    "antlr4",
):
    sys.modules.pop(module_name, None)

importlib.invalidate_caches()

try:
    assert importlib.util.find_spec("latex2sympy2_extended")
    assert importlib.util.find_spec("antlr4")
    assert importlib.metadata.version("antlr4-python3-runtime") == "${ANTLR4_RUNTIME_VERSION}"
    assert importlib.metadata.version("latex2sympy2-extended") == "${EXTENDED_PARSER_VERSION}"
    from latex2sympy2_extended import latex2sympy
    from sympy import simplify, latex
    import antlr4
    expr = latex2sympy(r"2^{5} + 2^{4} + 2^{2} + 2^{0}")
    result = latex(simplify(expr.doit().doit()))
    assert result == "53"
    validation_result = json.dumps({"ok": True})
except Exception as error:
    validation_result = json.dumps({"ok": False, "error": repr(error)})
finally:
    while staging_cache_path in sys.path:
        sys.path.remove(staging_cache_path)
    if active_cache_path not in sys.path:
        sys.path.insert(0, active_cache_path)
    importlib.invalidate_caches()

validation_result
`);
        return JSON.parse(String(result));
      };
      const ensurePyodideScript = async () => {
        if (typeof pageWindow.loadPyodide === "function") {
          return;
        }
        if (!scriptLoadPromise) {
          scriptLoadPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector(
              `script[data-mathcha-helper='pyodide'][src='${PYODIDE_SCRIPT_URL}']`
            );
            if (existingScript) {
              existingScript.addEventListener("load", () => resolve(), { once: true });
              existingScript.addEventListener("error", () => reject(new Error("Failed to load Pyodide script")), {
                once: true
              });
              return;
            }
            const script = document.createElement("script");
            script.src = PYODIDE_SCRIPT_URL;
            script.async = true;
            script.dataset.mathchaHelper = "pyodide";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load Pyodide script"));
            document.head.appendChild(script);
          }).then(() => {
            if (typeof pageWindow.loadPyodide !== "function") {
              throw new Error("Pyodide loaded but did not expose loadPyodide");
            }
          }).catch((error) => {
            scriptLoadPromise = null;
            throw error;
          });
        }
        return scriptLoadPromise;
      };
      const getPyodide = async () => {
        if (!pyodidePromise) {
          notify("Loading Python runtime...");
          pyodidePromise = ensurePyodideScript().then(() => {
            const loadPyodide = pageWindow.loadPyodide;
            if (typeof loadPyodide !== "function") {
              throw new Error("loadPyodide is unavailable");
            }
            return loadPyodide({ indexURL: PYODIDE_INDEX_URL });
          }).catch((error) => {
            pyodidePromise = null;
            throw error;
          });
        }
        return pyodidePromise;
      };
      const ensureSolver = async () => {
        const pyodide = await getPyodide();
        await ensurePersistentFs(pyodide);
        await ensurePersistentImports(pyodide);
        notify("Loading core math packages...");
        await pyodide.loadPackage(["mpmath", "sympy"]);
        if (!solverPromise) {
          solverPromise = (async () => {
            const cacheState = await readCacheState(pyodide);
            let cachedSolver = cacheState.status === "ready" && hasPersistedSolverFiles(pyodide);
            if (cacheState.status === "installing" || cacheState.status === "broken") {
              log(`Cached solver state is ${cacheState.status}, clearing staging cache`);
              await clearStagingSolver(pyodide);
            }
            if (cachedSolver) {
              const validCache = await validatePersistedSolver(pyodide);
              if (validCache.ok) {
                log("Using cached solver packages from IndexedDB");
              } else {
                log("Cached solver validation failed:", validCache.error ?? "unknown reason");
                log("Cached solver validation failed, keeping active cache until staged reinstall succeeds");
                await writeCacheState(pyodide, { status: "broken" });
                cachedSolver = false;
              }
            }
            if (!cachedSolver) {
              await writeCacheState(pyodide, { status: "installing", version: SCRIPT_VERSION });
              notify("Loading Python solver packages...");
              await pyodide.loadPackage("micropip");
              await suspendActiveCacheImports(pyodide);
              const micropip = pyodide.pyimport("micropip");
              try {
                log(`Installing antlr4-python3-runtime==${ANTLR4_RUNTIME_VERSION}`);
                await micropip.install([`antlr4-python3-runtime==${ANTLR4_RUNTIME_VERSION}`], { reinstall: true });
                log(`Installing latex2sympy2-extended[antlr4-13-2]==${EXTENDED_PARSER_VERSION}`);
                await micropip.install([`latex2sympy2-extended[antlr4-13-2]==${EXTENDED_PARSER_VERSION}`], {
                  reinstall: true
                });
              } finally {
                micropip.destroy?.();
              }
              try {
                await stageInstalledSolver(pyodide);
                const validStagedCache = await validateStagedSolver(pyodide);
                if (!validStagedCache.ok) {
                  throw new Error(
                    `Staged solver cache validation failed: ${validStagedCache.error ?? "unknown reason"}`
                  );
                }
                await promoteStagedSolver(pyodide);
              } finally {
                await restoreActiveCacheImports(pyodide);
              }
            } else {
              await writeCacheState(pyodide, { status: "ready", version: SCRIPT_VERSION });
            }
            notify("Preparing local LaTeX solver...");
            await pyodide.runPythonAsync(`
from latex2sympy2_extended import latex2sympy
from sympy import simplify, latex

def mathcha_solve_latex(input_latex):
    expr = latex2sympy(input_latex)
    result = simplify(expr.doit().doit())
    return latex(result)
`);
            const runtimeSmokeTest = await validateRuntimeSolverSmokeTest(pyodide);
            if (!runtimeSmokeTest.ok) {
              throw new Error(`Runtime solver smoke test failed: ${runtimeSmokeTest.error ?? "unknown reason"}`);
            }
          })().catch((error) => {
            solverPromise = null;
            void writeCacheState(pyodide, { status: "broken", version: SCRIPT_VERSION });
            throw error;
          });
        }
        await solverPromise;
        return pyodide;
      };
      return {
        async helloWorld() {
          const pyodide = await getPyodide();
          return String(pyodide.runPython("'hello world from python'"));
        },
        async solveLatex(latexInput) {
          const pyodide = await ensureSolver();
          const globals = pyodide.globals;
          globals.set("mathcha_input_latex", latexInput);
          try {
            const result = await pyodide.runPythonAsync("mathcha_solve_latex(mathcha_input_latex)");
            return String(result);
          } finally {
            globals.delete("mathcha_input_latex");
          }
        },
        async warmup() {
          const pyodide = await getPyodide();
          const hello = String(pyodide.runPython("'hello world from python'"));
          log("Python startup test passed:", hello);
          await ensureSolver();
        }
      };
    })();
    const menuIntegration = {
      createMenuItem(text, shortcut, onClick) {
        const item = document.createElement("ct-item");
        item.className = "clipboard";
        item.tabIndex = -1;
        const icon = document.createElement("ct-icon");
        const iconGlyph = document.createElement("i");
        iconGlyph.className = "fa fa-magic";
        iconGlyph.setAttribute("aria-hidden", "true");
        icon.appendChild(iconGlyph);
        const name = document.createElement("ct-name");
        name.textContent = `${text} `;
        if (shortcut) {
          const span = document.createElement("span");
          span.style.fontSize = "11px";
          span.style.color = "lightgray";
          span.textContent = `(Ctrl+Alt+${shortcut})`;
          name.appendChild(span);
        }
        item.append(icon, name);
        if (onClick) {
          item.addEventListener("click", () => {
            void onClick();
          });
        }
        return item;
      },
      injectCustomMenu() {
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node instanceof Element && node.matches("context-menu-container")) {
                this.addCustomItems(node);
              }
            }
          }
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      },
      addCustomItems(menuContainer) {
        const menus = menuContainer.querySelector("ct-menus");
        if (!menus) return;
        const separator = document.createElement("ct-separator");
        menus.appendChild(separator);
        const lastAiService = GM_getValue("lastAiService", "claude") ?? "claude";
        const items = [
          {
            text: "Paste From LaTeX",
            shortcut: config.aiShortcuts.pasteFromLatex,
            handler: async () => {
              try {
                const latex = await mathcha.importFromLatexClipboard();
                notify(`Imported LaTeX: ${latex.slice(0, 40)}${latex.length > 40 ? "..." : ""}`);
              } catch (error) {
                logError("Menu handler import error:", error);
                const message = error instanceof Error ? error.message : "Failed to import LaTeX";
                notify(`Import error: ${message}`, true);
              }
            }
          },
          {
            text: "Analyze with AI",
            shortcut: config.aiShortcuts.analyze,
            handler: async () => {
              try {
                const latex = await mathcha.copyToClipboard();
                services.openAiService(latex, lastAiService);
              } catch {
                return;
              }
            }
          },
          {
            text: "Solve with Symbolab",
            shortcut: config.aiShortcuts.symbolab,
            handler: async () => {
              try {
                const latex = await mathcha.copyToClipboard();
                services.symbolab(latex);
              } catch {
                return;
              }
            }
          },
          {
            text: "Solve with Python",
            shortcut: config.aiShortcuts.answer,
            handler: async () => {
              try {
                log("Menu item: Solve with Python clicked");
                const latex = await mathcha.extractSelectedLatexForSolver();
                const answer = await pythonRuntime.solveLatex(latex);
                const insertionLatex = `=${answer}`;
                log("Formatted answer:", insertionLatex);
                await mathcha.insertMathAtSelectionEnd(insertionLatex, { forceMathMode: true });
                notify(`Answer inserted: ${insertionLatex}`);
              } catch (error) {
                logError("Menu handler error:", error);
                const message = error instanceof Error ? error.message : "Failed to solve LaTeX locally";
                notify(`Local Python solve error: ${message}`, true);
              }
            }
          }
        ];
        items.forEach((item) => {
          menus.appendChild(this.createMenuItem(item.text, item.shortcut, item.handler));
        });
      }
    };
    const commands = {
      copyLatex: async () => {
        try {
          await mathcha.copyToClipboard();
          notify("LaTeX copied");
        } catch {
          return;
        }
      },
      analyze: async () => {
        try {
          const latex = await mathcha.copyToClipboard();
          const lastAiService = GM_getValue("lastAiService", "claude") ?? "claude";
          services.openAiService(latex, lastAiService);
        } catch {
          return;
        }
      },
      symbolab: async () => {
        try {
          const latex = await mathcha.copyToClipboard();
          services.symbolab(latex);
        } catch {
          return;
        }
      },
      answer: async () => {
        try {
          log("Auto-answer command triggered");
          const latex = await mathcha.extractSelectedLatexForSolver();
          log("LaTeX extracted:", latex);
          const answer = await pythonRuntime.solveLatex(latex);
          const insertionLatex = `=${answer}`;
          log("Formatted answer:", insertionLatex);
          await mathcha.insertMathAtSelectionEnd(insertionLatex, { forceMathMode: true });
          notify(`Answer inserted: ${insertionLatex}`);
        } catch (error) {
          logError("Auto-answer error:", error);
          const message = error instanceof Error ? error.message : "Failed to solve LaTeX locally";
          notify(`Local Python solve error: ${message}`, true);
        }
      },
      pasteFromLatex: async () => {
        try {
          log("Paste From LaTeX command triggered");
          const latex = await mathcha.importFromLatexClipboard();
          notify(`Imported LaTeX: ${latex.slice(0, 40)}${latex.length > 40 ? "..." : ""}`);
        } catch (error) {
          logError("Paste From LaTeX error:", error);
          const message = error instanceof Error ? error.message : "Failed to import LaTeX";
          notify(`Import error: ${message}`, true);
        }
      }
    };
    const aiTooltip = createTooltip();
    let isCtrlAltPressed = false;
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && !event.shiftKey) {
        if (!isCtrlAltPressed) {
          isCtrlAltPressed = true;
          aiTooltip.style.display = "block";
        }
        if (event.key === config.aiShortcuts.copyLatex) {
          event.preventDefault();
          void commands.copyLatex();
        } else if (event.key === config.aiShortcuts.analyze) {
          event.preventDefault();
          void commands.analyze();
        } else if (event.key === config.aiShortcuts.symbolab) {
          event.preventDefault();
          void commands.symbolab();
        } else if (event.key === config.aiShortcuts.answer) {
          event.preventDefault();
          log("Answer shortcut pressed (Ctrl+Alt+/)");
          void commands.answer();
        } else if (event.key === config.aiShortcuts.pasteFromLatex) {
          event.preventDefault();
          log("Paste From LaTeX shortcut pressed (Ctrl+Alt+,)");
          void commands.pasteFromLatex();
        }
      }
    });
    document.addEventListener("keyup", (event) => {
      if (!event.ctrlKey || !event.altKey) {
        isCtrlAltPressed = false;
        aiTooltip.style.display = "none";
      }
    });
    window.addEventListener("blur", () => {
      isCtrlAltPressed = false;
      aiTooltip.style.display = "none";
    });
    if (window.location.hostname.includes("mathcha.io")) {
      menuIntegration.injectCustomMenu();
      log("Initializing userscript");
      void pythonRuntime.warmup().then(() => {
        log("Background Python warmup finished");
      }).catch((error) => {
        logError("Background Python warmup failed:", error);
      });
      void loadMathJax().then(() => {
        notify("Mathcha Helper ready - Use Ctrl+Alt for AI + LaTeX features");
      }).catch(() => {
        notify("Mathcha Helper ready (LaTeX rendering not available)", true);
      });
    }
  })();
})();
