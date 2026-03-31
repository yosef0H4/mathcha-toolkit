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

  aiTooltip.innerHTML = `
    <div style="margin-bottom: 8px; font-weight: bold;">Toolkit Shortcuts (Ctrl+Alt+Key)</div>
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
    <div style="margin: 8px 0 0; padding-top: 8px; border-top: 1px solid #eee;">
      Answer format:
      <strong data-answer-format-label>${answerFormatLabels[getAnswerFormat()]}</strong>
    </div>
  `;

  document.body.appendChild(aiTooltip);
  return aiTooltip;
}

export function updateAnswerFormatUi(tooltip: HTMLDivElement | null): void {
  const formatLabel = tooltip?.querySelector<HTMLElement>("[data-answer-format-label]");
  if (formatLabel) {
    formatLabel.textContent = answerFormatLabels[getAnswerFormat()];
  }
}
