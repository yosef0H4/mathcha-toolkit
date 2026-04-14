import { SCRIPT_VERSION, answerInsertModeLabels, config, getAnswerFormat, getAnswerInsertMode } from "./config";
import { createMenuIntegration } from "./menu";
import { createPythonRuntime } from "./python-runtime";
import {
  answerFormatLabels,
  buildInsertedAnswerLatex,
  describeSolverError,
  formatBaseConvertedResult,
  formatSolverResult
} from "./solver-format";
import { createServices } from "./services";
import type { AiServiceKey, CommandKey, LogFn, MathchaRuntime, PyodideWindow, SolverInput } from "./types";
import { createTooltip, createNotifier, loadMathJax, updateSolverUi } from "./ui";
import { getPlatform } from "./platform";

export {};

export function bootstrapMathchaToolkit(): void {
  "use strict";

  const pageWindow = getPlatform().pageWindow as PyodideWindow;
  const logLabel = `[Mathcha Toolkit v${SCRIPT_VERSION}]`;
  const log: LogFn = (...args: unknown[]): void => console.log(logLabel, ...args);
  const logError: LogFn = (...args: unknown[]): void => console.error(logLabel, ...args);
  const notify = createNotifier();
  const mathcha = {
    getLatexIoHandler(
      editor:
        | {
            latexIoHandler?: {
              getSelectedLatex?: (type: string, ignoreSpace: boolean) => string | null;
              showImportFromLatex?: () => void;
              onSuccessfulParse?: (parsedLines: unknown) => void;
              renderImportLatexBox?: () => {
                type?: {
                  name?: string;
                  prototype?: {
                    parseLatex?: (latex: string) => unknown;
                    wrapInMathContainer?: (lines: unknown) => unknown;
                  };
                };
                props?: {
                  forMathMode?: boolean;
                  onSuccessfulParse?: (parsedLines: unknown) => void;
                };
              } | null;
            };
          }
        | null
    ):
      | {
          getSelectedLatex?: (type: string, ignoreSpace: boolean) => string | null;
          showImportFromLatex?: () => void;
          onSuccessfulParse?: (parsedLines: unknown) => void;
          renderImportLatexBox?: () => {
            type?: {
              name?: string;
              prototype?: {
                parseLatex?: (latex: string) => unknown;
                wrapInMathContainer?: (lines: unknown) => unknown;
              };
            };
            props?: {
              forMathMode?: boolean;
              onSuccessfulParse?: (parsedLines: unknown) => void;
            };
          } | null;
        }
      | null {
      return editor?.latexIoHandler ?? null;
    },

    summarizeValue(value: unknown, depth = 0): unknown {
      if (value === undefined) return "[undefined]";
      if (value === null) return null;
      if (depth > 3) return typeof value;
      if (Array.isArray(value)) return value.slice(0, 8).map((item) => this.summarizeValue(item, depth + 1));
      if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).slice(0, 20)) {
          out[key] = this.summarizeValue((value as Record<string, unknown>)[key], depth + 1);
        }
        return out;
      }
      return value;
    },

    logRuntime(step: string, details?: Record<string, unknown>): void {
      log(`[runtime] ${step}`, details ?? {});
    },

    getEditorInstance():
      | {
          latexIoHandler?: {
            getSelectedLatex?: (type: string, ignoreSpace: boolean) => string | null;
            showImportFromLatex?: () => void;
            onSuccessfulParse?: (parsedLines: unknown) => void;
            renderImportLatexBox?: () => {
              type?: {
                name?: string;
                prototype?: {
                  parseLatex?: (latex: string) => unknown;
                  wrapInMathContainer?: (lines: unknown) => unknown;
                };
              };
              props?: {
                forMathMode?: boolean;
                onSuccessfulParse?: (parsedLines: unknown) => void;
              };
            } | null;
          };
          getSelectedJson?: () => string;
          getContainerModel?: () => {
            cursorSelected?: unknown;
            extendedCursorSelected?: unknown;
            isTextModeSelected?: () => boolean;
          };
          clearSelection?: () => void;
          setSelected?: (selection: unknown) => void;
          setSelection?: (start: unknown, end: unknown) => void;
          setCursorInputFocus?: (focused: boolean) => void;
          setCursorMathTypeFocus?: (focused: boolean) => void;
        }
      | null {
      const mathTypeElement = document.querySelector("math-type") as
        | (HTMLElement & { reactInstance?: unknown })
        | null;
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
        constructorName: (editor as { constructor?: { name?: string } }).constructor?.name ?? null,
        keys: Object.keys(editor as Record<string, unknown>).slice(0, 20)
      });
      return editor as {
        latexIoHandler?: {
          getSelectedLatex?: (type: string, ignoreSpace: boolean) => string | null;
          showImportFromLatex?: () => void;
          onSuccessfulParse?: (parsedLines: unknown) => void;
        };
        getSelectedJson?: () => string;
        getContainerModel?: () => {
          cursorSelected?: unknown;
          extendedCursorSelected?: unknown;
          isTextModeSelected?: () => boolean;
        };
        clearSelection?: () => void;
        setSelected?: (selection: unknown) => void;
        setSelection?: (start: unknown, end: unknown) => void;
        setCursorInputFocus?: (focused: boolean) => void;
        setCursorMathTypeFocus?: (focused: boolean) => void;
      };
    },

    normalizeImportLatex(text: string): string {
      const trimmed = text.trim();
      if (/^\$\$[\s\S]*\$\$$/.test(trimmed)) {
        return trimmed.slice(2, -2).trim();
      }
      if (/^\$[\s\S]*\$/.test(trimmed)) {
        return trimmed.slice(1, -1).trim();
      }
      return trimmed;
    },

    getImportDialog():
      | {
          root: HTMLElement;
          textarea: HTMLTextAreaElement;
          okButton: HTMLButtonElement;
        }
      | null {
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

    getImportDialogElement(
      latexIoHandler:
        | {
            renderImportLatexBox?: () => {
              type?: {
                name?: string;
                prototype?: {
                  parseLatex?: (latex: string) => unknown;
                  wrapInMathContainer?: (lines: unknown) => unknown;
                };
              };
              props?: {
                forMathMode?: boolean;
                onSuccessfulParse?: (parsedLines: unknown) => void;
              };
            } | null;
          }
        | null
    ):
      | {
          type?: {
            name?: string;
            prototype?: {
              parseLatex?: (latex: string) => unknown;
              wrapInMathContainer?: (lines: unknown) => unknown;
            };
          };
          props?: {
            forMathMode?: boolean;
            onSuccessfulParse?: (parsedLines: unknown) => void;
          };
        }
      | null {
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

    findImportDialogComponentInstance():
      | {
          textArea?: { select?: () => void; focus?: () => void } | null;
          onOkClick?: () => void;
        }
      | null {
      const roots = Array.from(document.querySelectorAll("*")).slice(0, 600) as Array<
        Element & Record<string, unknown>
      >;

      const walkNode = (
        node: unknown,
        visited: WeakSet<object>,
        depth = 0
      ):
        | {
            textArea?: { select?: () => void; focus?: () => void } | null;
            onOkClick?: () => void;
          }
        | null => {
        if (!node || typeof node !== "object" || visited.has(node) || depth > 10) {
          return null;
        }

        visited.add(node);
        const maybeInstance = (
          node as {
            _instance?: {
              textArea?: { select?: () => void; focus?: () => void } | null;
              onOkClick?: () => void;
            };
            _renderedComponent?: unknown;
            _renderedChildren?: Record<string, unknown>;
          }
        )._instance;

        if (maybeInstance && "textArea" in maybeInstance && typeof maybeInstance.onOkClick === "function") {
          return maybeInstance;
        }

        const renderedComponent = (node as { _renderedComponent?: unknown })._renderedComponent;
        const componentHit = walkNode(renderedComponent, visited, depth + 1);
        if (componentHit) {
          return componentHit;
        }

        const renderedChildren = (node as { _renderedChildren?: Record<string, unknown> })._renderedChildren;
        if (renderedChildren && typeof renderedChildren === "object") {
          for (const child of Object.values(renderedChildren)) {
            const childHit = walkNode(child, visited, depth + 1);
            if (childHit) {
              return childHit;
            }
          }
        }

        return null;
      };

      for (const root of roots) {
        for (const key of Object.getOwnPropertyNames(root)) {
          if (!key.startsWith("__reactInternalInstance")) continue;
          const match = walkNode(root[key], new WeakSet<object>());
          if (match) {
            return match;
          }
        }
      }

      return null;
    },

    stabilizeImportDialogTextArea(): void {
      const instance = this.findImportDialogComponentInstance();
      if (!instance) {
        this.logRuntime("stabilizeImportDialogTextArea:missing-instance");
        return;
      }

      const currentDescriptor = Object.getOwnPropertyDescriptor(instance, "textArea");
      if (currentDescriptor?.get) {
        this.logRuntime("stabilizeImportDialogTextArea:already-patched");
        return;
      }

      const fallbackTextArea = {
        select(): void {},
        focus(): void {}
      };

      let currentTextArea = instance.textArea ?? fallbackTextArea;
      Object.defineProperty(instance, "textArea", {
        configurable: true,
        enumerable: true,
        get(): { select?: () => void; focus?: () => void } {
          return currentTextArea ?? fallbackTextArea;
        },
        set(nextValue: { select?: () => void; focus?: () => void } | null | undefined): void {
          currentTextArea = nextValue ?? fallbackTextArea;
        }
      });

      this.logRuntime("stabilizeImportDialogTextArea:patched", {
        hadTextArea: Boolean(instance.textArea)
      });
    },

    parseLatexWithRuntime(
      dialogElement:
        | {
            type?: {
              name?: string;
              prototype?: {
                parseLatex?: (latex: string) => unknown;
                wrapInMathContainer?: (lines: unknown) => unknown;
              };
            };
            props?: {
              forMathMode?: boolean;
            };
          }
        | null,
      latex: string,
      options?: { forceMathMode?: boolean }
    ): unknown[] {
      const dialogType = dialogElement?.type;
      const parseLatex = dialogType?.prototype?.parseLatex;
      if (typeof parseLatex !== "function") {
        throw new Error("Mathcha runtime parser is unavailable");
      }

      const forceMathMode = options?.forceMathMode ?? false;
      const parserLike = {
        props: {
          ...(dialogElement?.props ?? {}),
          ...(forceMathMode ? { forMathMode: true } : {})
        },
        wrapInMathContainer: dialogType?.prototype?.wrapInMathContainer
      };

      const parsed = parseLatex.call(parserLike, latex);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Mathcha parser returned no content");
      }

      this.logRuntime("parseLatexWithRuntime:parsed", {
        forMathMode: (parserLike.props as { forMathMode?: boolean }).forMathMode ?? null,
        parsedLength: parsed.length
      });

      return parsed;
    },

    buildImportPayload(
      dialogElement:
        | {
            props?: {
              forMathMode?: boolean;
            };
        }
        | null,
      parsed: unknown[],
      options?: { forceMathMode?: boolean }
    ): unknown {
      const forceMathMode = options?.forceMathMode ?? false;
      if (forceMathMode || dialogElement?.props?.forMathMode) {
        const mathLines = (
          parsed[0] as {
            blocks?: Array<{
              elements?: {
                mathValue?: {
                  lines?: unknown;
                };
              };
            }>;
          }
        )?.blocks?.[0]?.elements?.mathValue?.lines;
        if (!Array.isArray(mathLines) || mathLines.length === 0) {
          throw new Error("Mathcha runtime parser did not produce math-mode lines");
        }
        return mathLines;
      }

      return parsed;
    },

    getEditorModelFingerprint(
      editor:
        | ({
            state?: { mainModel?: unknown };
            getContainerModel?: () => { cursorSelected?: unknown; extendedCursorSelected?: unknown };
          } & Record<string, unknown>)
        | null
    ): string {
      const safeStringify = (value: unknown): string => {
        const seen = new WeakSet<object>();
        return JSON.stringify(value, (_key, currentValue) => {
          if (typeof currentValue === "object" && currentValue !== null) {
            if (seen.has(currentValue)) return "[circular]";
            seen.add(currentValue);
          }
          return currentValue;
        });
      };

      return safeStringify({
        mainModel: (editor?.state as { mainModel?: unknown } | undefined)?.mainModel ?? null,
        cursorSelected: editor?.getContainerModel?.()?.cursorSelected ?? null,
        extendedCursorSelected: editor?.getContainerModel?.()?.extendedCursorSelected ?? null
      });
    },

    async extractSelectedLatexForSolver(): Promise<SolverInput> {
      this.logRuntime("extractSelectedLatexForSolver:start");
      const rawLatex = await this.tryRuntimeLatexExtraction();
      if (!rawLatex) {
        throw new Error("No runtime LaTeX selection available for solver");
      }

      const selectionRange = this.getCurrentSelectionRange(this.getEditorInstance());
      const hasEquationTail = this.hasEquationTail(rawLatex);
      const isWrappedMathSelection = this.isWrappedMathSelection(rawLatex);
      const normalizedResult = this.normalizeLatexForSolver(rawLatex);
      this.logRuntime("extractSelectedLatexForSolver:success", {
        latexPreview: rawLatex.slice(0, 120),
        normalizedPreview: normalizedResult.normalized.slice(0, 120),
        hasEquationTail,
        isWrappedMathSelection,
        targetBase: normalizedResult.targetBase,
        hasSelectionStart: Boolean(selectionRange.start),
        hasSelectionEnd: Boolean(selectionRange.end)
      });
      return {
        raw: rawLatex,
        normalized: normalizedResult.normalized,
        hasEquationTail,
        isWrappedMathSelection,
        targetBase: normalizedResult.targetBase,
        selectionStart: selectionRange.start,
        selectionEnd: selectionRange.end
      };
    },

    isWrappedMathSelection(latex: string): boolean {
      const trimmed = latex.trim();
      return (
        (/^\$[\s\S]*\$$/.test(trimmed) && trimmed.length >= 2) ||
        (/^\$\$[\s\S]*\$\$$/.test(trimmed) && trimmed.length >= 4)
      );
    },

    hasEquationTail(latex: string): boolean {
      const normalized = this.normalizeImportLatex(latex.trim()).replace(/^\\displaystyle\s*/, "").trim();
      return this.findTopLevelEqualsIndex(normalized) >= 0;
    },

    findTopLevelEqualsIndex(latex: string): number {
      let braceDepth = 0;

      for (let index = 0; index < latex.length; index += 1) {
        const char = latex[index];

        if (char === "\\") {
          index += 1;
          continue;
        }

        if (char === "{") {
          braceDepth += 1;
          continue;
        }

        if (char === "}") {
          braceDepth = Math.max(0, braceDepth - 1);
          continue;
        }

        if (char === "=" && braceDepth === 0) {
          return index;
        }
      }

      return -1;
    },

    normalizeLatexForSolver(latex: string): { normalized: string; targetBase: number | null } {
      let normalized = latex.trim();
      normalized = this.normalizeImportLatex(normalized);
      normalized = normalized.replace(/^\\displaystyle\s*/, "").trim();

      const equationIndex = this.findTopLevelEqualsIndex(normalized);
      if (equationIndex >= 0) {
        normalized = normalized.slice(0, equationIndex).trim();
      }

      const { expression, targetBase } = this.extractBaseOutputDirective(normalized);
      const rewrittenExpression = this.rewriteBaseAnnotatedIntegers(expression).trim();

      this.logRuntime("normalizeLatexForSolver:complete", {
        inputPreview: latex.slice(0, 120),
        outputPreview: rewrittenExpression.slice(0, 120),
        targetBase
      });

      if (!rewrittenExpression) {
        throw new Error("Selected LaTeX is empty after solver normalization");
      }

      return {
        normalized: rewrittenExpression,
        targetBase
      };
    },

    extractBaseOutputDirective(latex: string): { expression: string; targetBase: number | null } {
      if (/\\(?:to|rightarrow)\s*$/u.test(latex)) {
        throw new Error("Base output syntax is incomplete");
      }

      const directiveMatch = latex.match(
        /^(.*?)(?:\\(?:to|rightarrow)\s*_\{\s*(\d+)\s*\}|\\(?:to|rightarrow)\s*_(\d+))\s*$/u
      );
      if (!directiveMatch) {
        return { expression: latex, targetBase: null };
      }

      const parsedBase = Number.parseInt(directiveMatch[2] ?? directiveMatch[3] ?? "", 10);
      if (!Number.isInteger(parsedBase) || parsedBase < 2 || parsedBase > 36) {
        throw new Error("Target base must be between 2 and 36");
      }

      return {
        expression: directiveMatch[1].trim(),
        targetBase: parsedBase
      };
    },

    rewriteBaseAnnotatedIntegers(latex: string): string {
      const tokenPattern = /([A-Za-z0-9]+)\s*_\{\s*(\d+)\s*\}|([A-Za-z0-9]+)\s*_(\d+)/gu;
      const isBoundary = (char: string | undefined): boolean =>
        char === undefined || /[\s+\-*/^=(),[\]{}]/u.test(char);

      return latex.replace(tokenPattern, (match, bracedDigits, bracedBase, plainDigits, plainBase, offset, source) => {
        const digits = String(bracedDigits ?? plainDigits ?? "");
        const rawBase = String(bracedBase ?? plainBase ?? "");
        const beforeChar = offset > 0 ? source[offset - 1] : undefined;
        const afterChar = source[offset + match.length];

        if (!isBoundary(beforeChar) || !isBoundary(afterChar)) {
          return match;
        }

        if (!/\d/u.test(digits) && digits.length <= 1) {
          return match;
        }

        const base = Number.parseInt(rawBase, 10);
        if (!Number.isInteger(base) || base < 2 || base > 36) {
          throw new Error(`Unsupported input base: ${rawBase}`);
        }

        return this.convertBaseIntegerLiteralToDecimal(digits, base);
      });
    },

    convertBaseIntegerLiteralToDecimal(digits: string, base: number): string {
      const normalizedDigits = digits.toUpperCase();
      let value = 0n;

      for (const char of normalizedDigits) {
        const digitValue = this.baseDigitValue(char);
        if (digitValue === null || digitValue >= base) {
          throw new Error(`Invalid digit '${char}' for base ${base}`);
        }
        value = value * BigInt(base) + BigInt(digitValue);
      }

      return value.toString();
    },

    baseDigitValue(char: string): number | null {
      if (/^[0-9]$/u.test(char)) {
        return Number.parseInt(char, 10);
      }

      if (/^[A-Z]$/u.test(char)) {
        return char.charCodeAt(0) - 55;
      }

      return null;
    },

    getCurrentSelectionRange(
      editor:
        | {
            getContainerModel?: () => {
              cursorSelected?: unknown;
              extendedCursorSelected?: unknown;
            };
          }
        | null
    ): { start: unknown | null; end: unknown | null } {
      const containerModel = editor?.getContainerModel?.();
      const start = containerModel?.cursorSelected ?? null;
      const end = containerModel?.extendedCursorSelected ?? null;
      this.logRuntime("getCurrentSelectionRange:resolved", {
        hasCursorSelected: Boolean(containerModel?.cursorSelected),
        hasExtendedCursorSelected: Boolean(containerModel?.extendedCursorSelected),
        start: start ? this.summarizeValue(start) : null,
        end: end ? this.summarizeValue(end) : null
      });
      return { start, end };
    },

    async insertMathAtSelection(
      latex: string,
      options?: {
        forceMathMode?: boolean;
        replaceSelection?: boolean;
        selectionStart?: unknown | null;
        selectionEnd?: unknown | null;
      }
    ): Promise<void> {
      const forceMathMode = options?.forceMathMode ?? true;
      const replaceSelection = options?.replaceSelection ?? false;
      const editor = this.getEditorInstance();
      const latexIoHandler = this.getLatexIoHandler(editor);
      if (!editor || !latexIoHandler || typeof latexIoHandler.showImportFromLatex !== "function") {
        throw new Error("Mathcha insert handler is unavailable");
      }

      const currentSelectionRange = this.getCurrentSelectionRange(editor);
      const selectionRange = {
        start: options?.selectionStart ?? currentSelectionRange.start,
        end: options?.selectionEnd ?? currentSelectionRange.end
      };
      const insertionTarget = selectionRange.end ?? selectionRange.start ?? null;
      if (!insertionTarget || typeof editor.setSelected !== "function") {
        throw new Error("Unable to resolve insertion point from current selection");
      }

      editor.setCursorInputFocus?.(true);
      editor.setCursorMathTypeFocus?.(true);
      if (replaceSelection && selectionRange.start && selectionRange.end && typeof editor.setSelection === "function") {
        editor.setSelection(selectionRange.start, selectionRange.end);
      } else {
        editor.setSelected(insertionTarget);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 30));

      const beforeModel = this.getEditorModelFingerprint(editor as Record<string, unknown> | null);
      latexIoHandler.showImportFromLatex();
      this.stabilizeImportDialogTextArea();
      const dialogElement = this.getImportDialogElement(latexIoHandler);
      if (!dialogElement) {
        throw new Error("Mathcha import runtime dialog element is unavailable");
      }

      const parsed = this.parseLatexWithRuntime(dialogElement, latex, { forceMathMode });
      const payload = this.buildImportPayload(dialogElement, parsed, { forceMathMode });
      this.logRuntime("insertMathAtSelection:parsed", {
        latexPreview: latex.slice(0, 120),
        replaceSelection,
        effectiveMathMode: forceMathMode || dialogElement.props?.forMathMode || false,
        payloadKind: Array.isArray(payload) ? "lines" : typeof payload
      });

      if (typeof latexIoHandler.onSuccessfulParse !== "function") {
        throw new Error("Mathcha import apply handler is unavailable");
      }

      latexIoHandler.onSuccessfulParse(payload);
      await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard * 2));

      const afterModel = this.getEditorModelFingerprint(editor as Record<string, unknown> | null);
      if (beforeModel === afterModel) {
        throw new Error("Mathcha insert did not change the editor");
      }

      this.logRuntime("insertMathAtSelection:complete", {
        changed: beforeModel !== afterModel,
        replaceSelection,
        dialogStillOpen: Boolean(document.querySelector(".import-latex"))
      });
    },

    async importFromLatexClipboard(): Promise<string> {
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
      const beforeModel = this.getEditorModelFingerprint(editor as Record<string, unknown> | null);
      try {
        latexIoHandler.showImportFromLatex();
        this.stabilizeImportDialogTextArea();
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
        this.stabilizeImportDialogTextArea();
        await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard));

        const dialog = this.getImportDialog();
        if (!dialog) {
          throw new Error("Import dialog did not open");
        }

        dialog.textarea.focus();
        dialog.textarea.value = normalizedLatex;
        dialog.textarea.dispatchEvent(new Event("input", { bubbles: true }));
        dialog.textarea.dispatchEvent(new Event("change", { bubbles: true }));

        await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard * 4));

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

      await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard * 2));

      const afterModel = this.getEditorModelFingerprint(editor as Record<string, unknown> | null);
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

    cloneSelection<T>(value: T): T {
      return JSON.parse(JSON.stringify(value)) as T;
    },

    bumpDeepestCharIndex(selection: unknown, delta: number): unknown {
      const clone = this.cloneSelection(selection);
      let cursor = clone as
        | {
            selected?: unknown;
            charIndex?: number;
          }
        | undefined;

      while (cursor && typeof cursor === "object" && cursor.selected && typeof cursor.selected === "object") {
        const child = cursor.selected as { selected?: unknown; charIndex?: number; key?: unknown };
        if (typeof child.charIndex === "number" && child.key === undefined) {
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

    inferCompositeAnchorSelection(
      compositeNode: HTMLElement & {
        reactInstance?: { props?: { data?: { elements?: Record<string, unknown> } } };
      }
    ): { key: string; selected: { lineIndex: number; charIndex: number } } | null {
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

    findCompositeSelectionNode(): (HTMLElement & {
      reactInstance?: {
        props?: {
          onSelectedChanged?: (selection: unknown, options?: unknown) => void;
          data?: { elements?: Record<string, unknown> };
        };
      };
    }) | null {
      const selection = window.getSelection();
      const candidates: Element[] = [];

      const pushCandidate = (element: Element | null): void => {
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
        if (
          compositeNode instanceof HTMLElement &&
          typeof (compositeNode as { reactInstance?: { props?: { onSelectedChanged?: unknown } } }).reactInstance?.props
            ?.onSelectedChanged === "function"
        ) {
          this.logRuntime("findCompositeSelectionNode:resolved", {
            tagName: compositeNode.tagName,
            className: compositeNode.className,
            dataText:
              (
                compositeNode as HTMLElement & {
                  reactInstance?: { props?: { data?: { text?: string } } };
                }
              ).reactInstance?.props?.data?.text ?? null
          });
          return compositeNode as HTMLElement & {
            reactInstance?: {
              props?: {
                onSelectedChanged?: (selection: unknown, options?: unknown) => void;
                data?: { elements?: Record<string, unknown> };
              };
            };
          };
        }
      }

      this.logRuntime("findCompositeSelectionNode:missing");
      return null;
    },

    async tryRuntimeLatexExtraction(): Promise<string | null> {
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
        await new Promise<void>((resolve) => setTimeout(resolve, 30));

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
        await new Promise<void>((resolve) => setTimeout(resolve, 30));

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

    findLatexButton(): Element | null {
      const strategies: Array<() => Element | null> = [
        () => document.querySelector("ct-item.clipboard.copy-latex"),
        () =>
          document.querySelector(
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

    async getLatex(): Promise<boolean> {
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

      await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard));

      const menuButton = this.findLatexButton();
      if (!(menuButton instanceof HTMLElement)) return false;

      menuButton.click();
      return true;
    },

    async copyToClipboard(): Promise<string> {
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

          await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard));
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
          await new Promise<void>((resolve) => setTimeout(resolve, config.delay.retry[attempt]));
        }
      }

      throw new Error("Unreachable");
    }
  };

  const services = createServices({ notify, log });
  const pythonRuntime = createPythonRuntime({ pageWindow, log, notify });

  const solveAndInsertAnswer = async (): Promise<string> => {
    const solverInput = await mathcha.extractSelectedLatexForSolver();
    log("LaTeX extracted:", solverInput.normalized);

    const answerFormat = getAnswerFormat();
    const answerInsertMode = getAnswerInsertMode();
    const solverResult = await pythonRuntime.solveLatex(solverInput.normalized);
    const formatted =
      solverInput.targetBase !== null
        ? formatBaseConvertedResult(solverResult, solverInput.targetBase)
        : formatSolverResult(solverResult, answerFormat);
    const insertionLatex = buildInsertedAnswerLatex(solverInput, formatted.latex, answerInsertMode);

    log(
      "Selected answer format:",
      solverInput.targetBase !== null ? `Base ${solverInput.targetBase}` : answerFormatLabels[answerFormat]
    );
    log("Selected answer insert mode:", answerInsertModeLabels[answerInsertMode]);
    mathcha.logRuntime("solveAndInsertAnswer:formatted", {
      answerFormat,
      answerInsertMode,
      targetBase: solverInput.targetBase,
      baseOverride: solverInput.targetBase !== null,
      fallbackReason: formatted.fallbackReason,
      exactLatexPreview: solverResult.latex.slice(0, 120),
      formattedPreview: formatted.latex.slice(0, 120),
      insertionPreview: insertionLatex.slice(0, 120)
    });
    log("Formatted answer:", insertionLatex);

    await mathcha.insertMathAtSelection(insertionLatex, {
      forceMathMode: !solverInput.isWrappedMathSelection,
      replaceSelection: answerInsertMode === "replace",
      selectionStart: solverInput.selectionStart,
      selectionEnd: solverInput.selectionEnd
    });

    const actionText = answerInsertMode === "replace" ? "replaced selection" : "inserted";
    if (formatted.fallbackReason) {
      notify(`Answer ${actionText} using exact format fallback (${answerFormatLabels[answerFormat]})`);
    } else {
      notify(`Answer ${actionText}: ${insertionLatex}`);
    }

    return insertionLatex;
  };

  const aiTooltip = createTooltip();
  const menuIntegration = createMenuIntegration({
    aiTooltip,
    log,
    logError,
    mathcha: mathcha as MathchaRuntime,
    notify,
    services,
    solveAndInsertAnswer,
    updateSolverUi,
    describeSolverError
  });

  const commands: Record<CommandKey, () => Promise<void>> = {
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
        const lastAiService = (getPlatform().getValue("lastAiService", "claude") as AiServiceKey) ?? "claude";
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
        await solveAndInsertAnswer();
      } catch (error) {
        logError("Auto-answer error:", error);
        notify(describeSolverError(error), true);
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

  window.__MATHCHA_TOOLKIT__ = {
    version: SCRIPT_VERSION,
    platform: getPlatform().kind,
    commands
  };

  let isCtrlAltPressed = false;

  document.addEventListener("keydown", (event: KeyboardEvent) => {
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

  document.addEventListener("keyup", (event: KeyboardEvent) => {
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
    void pythonRuntime
      .warmup()
      .then(() => {
        log("Background Python warmup finished");
      })
      .catch((error) => {
        logError("Background Python warmup failed:", error);
      });
    void loadMathJax()
      .then(() => {
        notify("Mathcha Toolkit ready - Use Ctrl+Alt for tools");
      })
      .catch(() => {
        notify("Mathcha Toolkit ready (LaTeX rendering not available)", true);
      });
  }
}
