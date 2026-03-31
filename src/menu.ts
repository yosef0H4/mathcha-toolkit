import { answerFormatLabels, config, cycleAnswerFormat, getAnswerFormat } from "./config";
import type { AiServiceKey, LogFn, MathchaRuntime, NotifyFn, SolveAndInsertAnswer } from "./types";

export function createMenuIntegration({
  aiTooltip,
  log,
  logError,
  mathcha,
  notify,
  services,
  solveAndInsertAnswer,
  updateAnswerFormatUi,
  describeSolverError
}: {
  aiTooltip: HTMLDivElement;
  log: LogFn;
  logError: LogFn;
  mathcha: MathchaRuntime;
  notify: NotifyFn;
  services: {
    openAiService: (latex: string, serviceKey: AiServiceKey) => void;
    symbolab: (latex: string) => void;
  };
  solveAndInsertAnswer: SolveAndInsertAnswer;
  updateAnswerFormatUi: (tooltip: HTMLDivElement | null) => void;
  describeSolverError: (error: unknown) => string;
}) {
  return {
    fitMenuToViewport(menuContainer: Element, menus: Element): void {
      if (!(menuContainer instanceof HTMLElement)) return;

      window.requestAnimationFrame(() => {
        const margin = 8;
        const maxHeight = Math.max(160, window.innerHeight - margin * 2);
        menuContainer.style.maxHeight = `${maxHeight}px`;
        menuContainer.style.overflowY = "auto";

        if (menus instanceof HTMLElement) {
          menus.style.maxHeight = "none";
        }

        const rect = menuContainer.getBoundingClientRect();
        const overflowBottom = rect.bottom - (window.innerHeight - margin);
        const overflowTop = margin - rect.top;
        const currentTop = Number.parseFloat(menuContainer.style.top || "0");

        if (overflowBottom > 0) {
          menuContainer.style.top = `${Math.max(margin, currentTop - overflowBottom)}px`;
        } else if (overflowTop > 0) {
          menuContainer.style.top = `${currentTop + overflowTop}px`;
        }
      });
    },

    createMenuItem(text: string, shortcut: string, onClick: (() => void | Promise<void>) | null): HTMLElement {
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

    injectCustomMenu(): void {
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

    addCustomItems(menuContainer: Element): void {
      const menus = menuContainer.querySelector("ct-menus");
      if (!menus) return;

      const separator = document.createElement("ct-separator");
      menus.appendChild(separator);

      const lastAiService = (GM_getValue("lastAiService", "claude") as AiServiceKey) ?? "claude";
      const items: Array<{ text: string; shortcut: string; handler: () => Promise<void> }> = [
        {
          text: `Answer Format: ${answerFormatLabels[getAnswerFormat()]}`,
          shortcut: "",
          handler: async () => {
            const nextFormat = cycleAnswerFormat();
            updateAnswerFormatUi(aiTooltip);
            notify(`Answer format: ${answerFormatLabels[nextFormat]}`);
          }
        },
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
              await solveAndInsertAnswer();
            } catch (error) {
              logError("Menu handler error:", error);
              notify(describeSolverError(error), true);
            }
          }
        }
      ];

      items.forEach((item) => {
        menus.appendChild(this.createMenuItem(item.text, item.shortcut, item.handler));
      });

      this.fitMenuToViewport(menuContainer, menus);
    }
  };
}
