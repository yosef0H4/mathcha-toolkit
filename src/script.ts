type AiServiceKey = "claude" | "chatgpt" | "gemini";
type CommandKey = "copyLatex" | "analyze" | "symbolab" | "answer";

export {};

type MathJaxConfig = {
  tex: {
    inlineMath: string[][];
    displayMath: string[][];
  };
  svg: {
    fontCache: string;
  };
};

type AiService = {
  name: string;
  url: string;
};

type AppConfig = {
  aiShortcuts: Record<CommandKey, string>;
  delay: {
    standard: number;
    retry: number[];
  };
  maxRetries: number;
  aiServices: Record<AiServiceKey, AiService>;
  pythonServer: {
    url: string;
    timeout: number;
  };
};

type PythonServerResponse = {
  success?: boolean;
  answer?: string;
  error?: string;
};

declare global {
  interface Window {
    MathJax?: MathJaxConfig;
  }
}

(() => {
  "use strict";

  function loadMathJax(): Promise<void> {
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

  const config: AppConfig = {
    aiShortcuts: {
      copyLatex: "'",
      analyze: ";",
      symbolab: ".",
      answer: "/"
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
      gemini: {
        name: "Google Gemini",
        url: "https://gemini.google.com/?q=%s"
      }
    },
    pythonServer: {
      url: "http://localhost:5000/solve",
      timeout: 10000
    }
  };

  const notify = (() => {
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
  })();

  const createTooltip = (): HTMLDivElement => {
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
    `;

    document.body.appendChild(aiTooltip);
    return aiTooltip;
  };

  const mathcha = {
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
          const success = await this.getLatex();
          if (!success) throw new Error("Failed to find LaTeX button");

          await new Promise<void>((resolve) => setTimeout(resolve, config.delay.standard));
          const text = await navigator.clipboard.readText();
          if (!text) throw new Error("Clipboard is empty");

          return text;
        } catch (error) {
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

  const services = {
    openAiService(latex: string, serviceKey: AiServiceKey): void {
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

      const cleanup = (): void => {
        dialog.remove();
        overlay.remove();
      };

      submit.onclick = () => {
        const selectedService = config.aiServices[serviceSelector.value as AiServiceKey];
        const prompt = textarea.value.trim();
        GM_setValue("lastPrompt", prompt);
        GM_setValue("lastAiService", serviceSelector.value);

        const url = selectedService.url.replace("%s", encodeURIComponent(`${prompt}\n\n${latex}`));
        GM_openInTab(url, { active: true });
        cleanup();
      };

      cancel.onclick = cleanup;
      textarea.onkeydown = (event: KeyboardEvent) => {
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

    async pythonServer(latex: string): Promise<void> {
      try {
        notify("Sending to Python server...");
        console.log("[Mathcha Helper] Sending LaTeX to Python server:", latex);
        console.log("[Mathcha Helper] Request payload:", JSON.stringify({ latex }));

        const response = await fetch(config.pythonServer.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ latex })
        });

        const status = response.status;
        const responseText = await response.text();
        console.log(`[Mathcha Helper] Server response (${status}):`, responseText);

        let result: PythonServerResponse;
        try {
          result = JSON.parse(responseText) as PythonServerResponse;
        } catch (error) {
          console.error("[Mathcha Helper] Error parsing JSON response:", error);
          throw new Error(`Server returned invalid JSON (Status ${status})`);
        }

        if (!response.ok) {
          if (result.error) {
            throw new Error(`Server error: ${result.error}`);
          }

          throw new Error(`Server responded with ${status}`);
        }

        if (result.success && result.answer) {
          const answer = `$${result.answer}$`;
          console.log("[Mathcha Helper] Formatted answer:", answer);
          GM_setClipboard(answer);
          notify(`Answer: ${answer}`);
          return;
        }

        throw new Error("Server returned success but no answer");
      } catch (error) {
        console.error("[Mathcha Helper] Python server error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        notify(`Error: ${message}`, true);
      }
    },

    symbolab(latex: string): void {
      const cleaned = latex.replace(/\$/g, "").trim();
      GM_openInTab(`https://www.symbolab.com/solver/step-by-step/${encodeURIComponent(cleaned)}`, {
        active: true
      });
    }
  };

  const menuIntegration = {
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
              console.log("[Mathcha Helper] Menu item: Solve with Python clicked");
              const latex = await mathcha.copyToClipboard();
              await services.pythonServer(latex);
            } catch (error) {
              console.error("[Mathcha Helper] Menu handler error:", error);
            }
          }
        }
      ];

      items.forEach((item) => {
        menus.appendChild(this.createMenuItem(item.text, item.shortcut, item.handler));
      });
    }
  };

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
        const lastAiService = (GM_getValue("lastAiService", "claude") as AiServiceKey) ?? "claude";
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
        console.log("[Mathcha Helper] Auto-answer command triggered");
        const latex = await mathcha.copyToClipboard();
        console.log("[Mathcha Helper] LaTeX extracted:", latex);
        await services.pythonServer(latex);
      } catch (error) {
        console.error("[Mathcha Helper] Auto-answer error:", error);
      }
    }
  };

  const aiTooltip = createTooltip();
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
        console.log("[Mathcha Helper] Answer shortcut pressed (Ctrl+Alt+/)");
        void commands.answer();
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
    void loadMathJax()
      .then(() => {
        notify("Mathcha Helper ready - Use Ctrl+Alt for AI features");
      })
      .catch(() => {
        notify("Mathcha Helper ready (LaTeX rendering not available)", true);
      });
  }
})();
