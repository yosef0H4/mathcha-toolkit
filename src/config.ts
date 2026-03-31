import type { AnswerFormatKey, AppConfig } from "./types";

export const SCRIPT_VERSION = "2.4";
export const PYODIDE_VERSION = "0.29.3";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PYODIDE_SCRIPT_URL = `${PYODIDE_INDEX_URL}pyodide.js`;
export const EXTENDED_PARSER_VERSION = "1.11.0";
export const ANTLR4_RUNTIME_VERSION = "4.13.2";
export const PERSIST_ROOT = "/mathcha-helper-cache";
export const PERSIST_ACTIVE_ROOT = `${PERSIST_ROOT}/active`;
export const PERSIST_ACTIVE_SITE_PACKAGES = `${PERSIST_ACTIVE_ROOT}/site-packages`;
export const PERSIST_STAGING_ROOT = `${PERSIST_ROOT}/staging`;
export const PERSIST_STAGING_SITE_PACKAGES = `${PERSIST_STAGING_ROOT}/site-packages`;
export const PERSIST_BACKUP_ROOT = `${PERSIST_ROOT}/backup`;
export const PERSIST_STATE_FILE = `${PERSIST_ROOT}/cache-state.json`;

export const config: AppConfig = {
  aiShortcuts: {
    copyLatex: "'",
    analyze: ";",
    symbolab: ".",
    answer: "/",
    pasteFromLatex: ","
  },
  delay: {
    standard: 200,
    retry: [500, 1000]
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
    youcom: {
      name: "You.com",
      url: "https://you.com/search?q=%s&fromSearchBar=true&tbm=youchat"
    },
    perplexity: {
      name: "Perplexity",
      url: "https://www.perplexity.ai/search?q=%s"
    },
    grok: {
      name: "Grok",
      url: "https://grok.com/?q=%s"
    },
    mistral: {
      name: "Mistral Le Chat",
      url: "https://chat.mistral.ai/chat?q=%s"
    }
  },
  solver: {
    defaultAnswerFormat: "fraction",
    decimalPlaces: 6
  }
};

export const ANSWER_FORMAT_STORAGE_KEY = "answerFormat";
export const answerFormatLabels: Record<AnswerFormatKey, string> = {
  fraction: "Exact Fraction",
  decimal: "Decimal",
  mixed: "Mixed Number"
};

export const getAnswerFormat = (): AnswerFormatKey => {
  const stored = GM_getValue(ANSWER_FORMAT_STORAGE_KEY, config.solver.defaultAnswerFormat);
  return stored === "fraction" || stored === "decimal" || stored === "mixed"
    ? stored
    : config.solver.defaultAnswerFormat;
};

export const setAnswerFormat = (format: AnswerFormatKey): void => {
  GM_setValue(ANSWER_FORMAT_STORAGE_KEY, format);
};

export const cycleAnswerFormat = (): AnswerFormatKey => {
  const formats: AnswerFormatKey[] = ["fraction", "decimal", "mixed"];
  const current = getAnswerFormat();
  const next = formats[(formats.indexOf(current) + 1) % formats.length];
  setAnswerFormat(next);
  return next;
};
