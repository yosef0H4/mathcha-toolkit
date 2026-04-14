import type { PyodideInterface } from "pyodide";

export type AiServiceKey = "claude" | "chatgpt" | "google" | "youcom" | "perplexity" | "grok" | "mistral";
export type CommandKey = "copyLatex" | "analyze" | "symbolab" | "answer" | "pasteFromLatex";
export type AnswerFormatKey = "fraction" | "decimal" | "mixed";
export type AnswerInsertModeKey = "append" | "replace";

export type LoadPyodide = typeof import("pyodide").loadPyodide;

export type MathJaxConfig = {
  tex: {
    inlineMath: string[][];
    displayMath: string[][];
  };
  svg: {
    fontCache: string;
  };
};

export type AiService = {
  name: string;
  url: string;
};

export type AppConfig = {
  aiShortcuts: Record<CommandKey, string>;
  delay: {
    standard: number;
    retry: number[];
  };
  maxRetries: number;
  aiServices: Record<AiServiceKey, AiService>;
  solver: {
    defaultAnswerFormat: AnswerFormatKey;
    defaultAnswerInsertMode: AnswerInsertModeKey;
    decimalPlaces: number;
  };
};

export type SolverInput = {
  raw: string;
  normalized: string;
  hasEquationTail: boolean;
  isWrappedMathSelection: boolean;
  targetBase: number | null;
  selectionStart: unknown | null;
  selectionEnd: unknown | null;
};

export type SolverResult = {
  latex: string;
  isRational: boolean;
  numerator: string | null;
  denominator: string | null;
  decimal: string | null;
};

export type PyodideWindow = Window & typeof globalThis & { loadPyodide?: LoadPyodide };
export type LogFn = (...args: unknown[]) => void;
export type NotifyFn = (message: string, isError?: boolean) => void;
export type OpenTabOptions = { active?: boolean };

export type ToolkitPlatform = {
  kind: "userscript" | "extension" | "console";
  pageWindow: PyodideWindow;
  getValue: <T>(key: string, fallback: T) => T;
  setValue: (key: string, value: unknown) => void;
  openTab: (url: string, options?: OpenTabOptions) => void;
};

export type PythonRuntime = {
  helloWorld(): Promise<string>;
  solveLatex(latexInput: string): Promise<SolverResult>;
  warmup(): Promise<void>;
};

export type MathchaRuntime = {
  logRuntime(step: string, details?: Record<string, unknown>): void;
  extractSelectedLatexForSolver(): Promise<SolverInput>;
  insertMathAtSelection(
    latex: string,
    options?: {
      forceMathMode?: boolean;
      replaceSelection?: boolean;
      selectionStart?: unknown | null;
      selectionEnd?: unknown | null;
    }
  ): Promise<void>;
  importFromLatexClipboard(): Promise<string>;
  copyToClipboard(): Promise<string>;
};

export type SolveAndInsertAnswer = () => Promise<string>;

declare global {
  interface Window {
    MathJax?: MathJaxConfig;
    mathGlobal?: Record<string, unknown>;
    __MATHCHA_TOOLKIT_EXTENSION_INIT__?: {
      state?: Record<string, unknown>;
      channel?: string;
    };
    __MATHCHA_TOOLKIT__?: {
      version: string;
      platform: string;
      commands: Record<CommandKey, () => Promise<void>>;
    };
  }
}

export type { PyodideInterface };
