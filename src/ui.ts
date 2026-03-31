import type { MathJaxConfig, NotifyFn } from "./types";
import { answerFormatLabels, config, getAnswerFormat } from "./config";

export function loadMathJax(): Promise<void> {
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
    } as MathJaxConfig;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load MathJax"));
    document.head.appendChild(script);
  });
}

export function createNotifier(): NotifyFn {
  let current: HTMLDivElement | null = null;

  return (message: string, isError = false): void => {
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
    setTimeout(() => toast.remove(), 2000);
  };
}

export function createTooltip(): HTMLDivElement {
  const aiTooltip = document.createElement("div");
  aiTooltip.style.cssText = `
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

  const title = document.createElement("div");
  title.textContent = "Toolkit Shortcuts (Ctrl+Alt+Key)";
  title.style.marginBottom = "8px";
  title.style.fontWeight = "bold";

  const createShortcutRow = (shortcut: string, description: string): HTMLDivElement => {
    const row = document.createElement("div");
    row.style.margin = "4px 0";

    const key = document.createElement("kbd");
    key.textContent = shortcut;
    row.append(key, document.createTextNode(` - ${description}`));
    return row;
  };

  const answerFormatContainer = document.createElement("div");
  answerFormatContainer.style.margin = "8px 0 0";
  answerFormatContainer.style.paddingTop = "8px";
  answerFormatContainer.style.borderTop = "1px solid #eee";
  answerFormatContainer.append(document.createTextNode("Answer format: "));

  const formatLabel = document.createElement("strong");
  formatLabel.dataset.answerFormatLabel = "";
  formatLabel.textContent = answerFormatLabels[getAnswerFormat()];
  answerFormatContainer.appendChild(formatLabel);

  aiTooltip.append(
    title,
    createShortcutRow(config.aiShortcuts.copyLatex, "Copy LaTeX"),
    createShortcutRow(config.aiShortcuts.analyze, "Analyze with AI"),
    createShortcutRow(config.aiShortcuts.symbolab, "Open in Symbolab"),
    createShortcutRow(config.aiShortcuts.answer, "Solve with Python"),
    createShortcutRow(config.aiShortcuts.pasteFromLatex, "Paste From LaTeX"),
    answerFormatContainer
  );

  document.body.appendChild(aiTooltip);
  return aiTooltip;
}

export function updateAnswerFormatUi(tooltip: HTMLDivElement | null): void {
  const formatLabel = tooltip?.querySelector<HTMLElement>("[data-answer-format-label]");
  if (formatLabel) {
    formatLabel.textContent = answerFormatLabels[getAnswerFormat()];
  }
}
