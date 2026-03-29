import type { PyodideInterface } from "pyodide";

type AiServiceKey = "claude" | "chatgpt" | "gemini";
type CommandKey = "copyLatex" | "analyze" | "symbolab" | "answer" | "pythonHello";

export {};

type LoadPyodide = typeof import("pyodide").loadPyodide;

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
};

declare global {
  interface Window {
    MathJax?: MathJaxConfig;
  }
}

(() => {
  "use strict";

  const SCRIPT_VERSION = "2.3";
  const PYODIDE_VERSION = "0.29.3";
  const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const PYODIDE_SCRIPT_URL = `${PYODIDE_INDEX_URL}pyodide.js`;
  const EXTENDED_PARSER_VERSION = "1.11.0";
  const ANTLR4_RUNTIME_VERSION = "4.13.2";
  const PERSIST_ROOT = "/mathcha-helper-cache";
  const PERSIST_SITE_PACKAGES = `${PERSIST_ROOT}/site-packages`;
  const PERSIST_STATE_FILE = `${PERSIST_ROOT}/cache-state.json`;

  type PyodideWindow = Window & typeof globalThis & { loadPyodide?: LoadPyodide };
  const pageWindow = unsafeWindow as PyodideWindow;
  const logLabel = `[Mathcha Helper v${SCRIPT_VERSION}]`;
  const log = (...args: unknown[]): void => console.log(logLabel, ...args);
  const logError = (...args: unknown[]): void => console.error(logLabel, ...args);

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
      answer: "/",
      pythonHello: ","
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
      <div style="margin: 4px 0;">
        <kbd>${config.aiShortcuts.pythonHello}</kbd> - Python Hello Test
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

    symbolab(latex: string): void {
      const cleaned = latex.replace(/\$/g, "").trim();
      GM_openInTab(`https://www.symbolab.com/solver/step-by-step/${encodeURIComponent(cleaned)}`, {
        active: true
      });
    }
  };

  const pythonRuntime = (() => {
    let pyodidePromise: Promise<PyodideInterface> | null = null;
    let scriptLoadPromise: Promise<void> | null = null;
    let solverPromise: Promise<void> | null = null;
    let persistentFsPromise: Promise<void> | null = null;

    const syncFs = async (pyodide: PyodideInterface, populate: boolean): Promise<void> => {
      const fs = pyodide.FS as {
        syncfs: (populateArg: boolean, callback: (error?: Error | null) => void) => void;
      };

      await new Promise<void>((resolve, reject) => {
        fs.syncfs(populate, (error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    };

    const ensurePersistentFs = async (pyodide: PyodideInterface): Promise<void> => {
      if (!persistentFsPromise) {
        persistentFsPromise = (async () => {
          const fs = pyodide.FS as {
            mkdir: (path: string) => void;
            mount: (type: unknown, opts: { root: string }, mountpoint: string) => void;
            filesystems: { IDBFS: unknown };
            analyzePath: (path: string) => { exists: boolean };
          };

          if (!fs.analyzePath(PERSIST_ROOT).exists) {
            fs.mkdir(PERSIST_ROOT);
          }

          if (!fs.analyzePath(PERSIST_SITE_PACKAGES).exists) {
            fs.mkdir(PERSIST_SITE_PACKAGES);
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

    const readCacheState = async (
      pyodide: PyodideInterface
    ): Promise<{ status: "empty" | "installing" | "ready" | "broken"; version?: string }> => {
      const fs = pyodide.FS as {
        analyzePath: (path: string) => { exists: boolean };
        readFile: (path: string, opts: { encoding: "utf8" }) => string;
      };

      if (!fs.analyzePath(PERSIST_STATE_FILE).exists) {
        return { status: "empty" };
      }

      try {
        return JSON.parse(fs.readFile(PERSIST_STATE_FILE, { encoding: "utf8" })) as {
          status: "empty" | "installing" | "ready" | "broken";
          version?: string;
        };
      } catch {
        return { status: "broken" };
      }
    };

    const writeCacheState = async (
      pyodide: PyodideInterface,
      state: { status: "empty" | "installing" | "ready" | "broken"; version?: string }
    ): Promise<void> => {
      const fs = pyodide.FS as {
        writeFile: (path: string, data: string) => void;
      };

      fs.writeFile(PERSIST_STATE_FILE, JSON.stringify(state));
      await syncFs(pyodide, false);
    };

    const ensurePersistentImports = async (pyodide: PyodideInterface): Promise<void> => {
      await pyodide.runPythonAsync(`
import importlib
import sys

cache_path = "${PERSIST_SITE_PACKAGES}"
if cache_path not in sys.path:
    sys.path.insert(0, cache_path)
importlib.invalidate_caches()
`);
    };

    const hasPersistedSolver = async (pyodide: PyodideInterface): Promise<boolean> => {
      const result = await pyodide.runPythonAsync(`
import importlib.util
import importlib.metadata

bool(
    importlib.util.find_spec("latex2sympy2_extended")
    and importlib.util.find_spec("antlr4")
    and importlib.metadata.version("antlr4-python3-runtime")
    and importlib.metadata.version("latex2sympy2-extended")
)
`);
      return Boolean(result);
    };

    const validatePersistedSolver = async (pyodide: PyodideInterface): Promise<boolean> => {
      const result = await pyodide.runPythonAsync(`
import importlib
import importlib.metadata
import importlib.util

try:
    assert importlib.util.find_spec("latex2sympy2_extended")
    assert importlib.util.find_spec("antlr4")
    assert importlib.metadata.version("antlr4-python3-runtime") == "${ANTLR4_RUNTIME_VERSION}"
    assert importlib.metadata.version("latex2sympy2-extended") == "${EXTENDED_PARSER_VERSION}"
    from latex2sympy2_extended import latex2sympy
    import antlr4
    True
except Exception:
    False
`);
      return Boolean(result);
    };

    const clearPersistedSolver = async (pyodide: PyodideInterface): Promise<void> => {
      await pyodide.runPythonAsync(`
import pathlib
import shutil

target_root = pathlib.Path("${PERSIST_SITE_PACKAGES}")
target_root.mkdir(parents=True, exist_ok=True)

for name in (
    "latex2sympy2_extended",
    "antlr4",
    "antlr4_python3_runtime-${ANTLR4_RUNTIME_VERSION}.dist-info",
    "latex2sympy2_extended-${EXTENDED_PARSER_VERSION}.dist-info",
):
    path = target_root / name
    if path.exists():
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
`);
      await writeCacheState(pyodide, { status: "empty" });
    };

    const persistInstalledSolver = async (pyodide: PyodideInterface): Promise<void> => {
      await pyodide.runPythonAsync(`
import importlib
import importlib.util
import site
import pathlib
import shutil

target_root = pathlib.Path("${PERSIST_SITE_PACKAGES}")
target_root.mkdir(parents=True, exist_ok=True)

site_packages_root = pathlib.Path(site.getsitepackages()[0])

for module_name in ("latex2sympy2_extended", "antlr4"):
    spec = importlib.util.find_spec(module_name)
    if spec is None:
        raise ImportError(f"Cannot find installed module: {module_name}")

    if spec.submodule_search_locations:
        source_path = pathlib.Path(next(iter(spec.submodule_search_locations)))
        destination_path = target_root / source_path.name
        if destination_path.exists():
            shutil.rmtree(destination_path)
        shutil.copytree(source_path, destination_path)
    else:
        source_path = pathlib.Path(spec.origin)
        destination_path = target_root / source_path.name
        shutil.copy2(source_path, destination_path)

for metadata_dir in (
    site_packages_root / "antlr4_python3_runtime-${ANTLR4_RUNTIME_VERSION}.dist-info",
    site_packages_root / "latex2sympy2_extended-${EXTENDED_PARSER_VERSION}.dist-info",
):
    if metadata_dir.exists():
        destination_path = target_root / metadata_dir.name
        if destination_path.exists():
            shutil.rmtree(destination_path)
        shutil.copytree(metadata_dir, destination_path)

importlib.invalidate_caches()
`);
      await writeCacheState(pyodide, { status: "ready", version: SCRIPT_VERSION });
      log("Saving persistent Python cache to IndexedDB");
    };

    const ensurePyodideScript = async (): Promise<void> => {
      if (typeof pageWindow.loadPyodide === "function") {
        return;
      }

      if (!scriptLoadPromise) {
        scriptLoadPromise = new Promise<void>((resolve, reject) => {
          const existingScript = document.querySelector<HTMLScriptElement>(
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

    const getPyodide = async (): Promise<PyodideInterface> => {
      if (!pyodidePromise) {
        notify("Loading Python runtime...");
        pyodidePromise = ensurePyodideScript()
          .then(() => {
            const loadPyodide = pageWindow.loadPyodide;
            if (typeof loadPyodide !== "function") {
              throw new Error("loadPyodide is unavailable");
            }

            return loadPyodide({ indexURL: PYODIDE_INDEX_URL });
          })
          .catch((error) => {
          pyodidePromise = null;
          throw error;
        });
      }

      return pyodidePromise;
    };

    const ensureSolver = async (): Promise<PyodideInterface> => {
      const pyodide = await getPyodide();
      await ensurePersistentFs(pyodide);
      await ensurePersistentImports(pyodide);

      notify("Loading core math packages...");
      await pyodide.loadPackage(["mpmath", "sympy"]);

      if (!solverPromise) {
        solverPromise = (async () => {
          const cacheState = await readCacheState(pyodide);
          let cachedSolver = cacheState.status === "ready" && (await hasPersistedSolver(pyodide));

          if (cacheState.status === "installing" || cacheState.status === "broken") {
            log(`Cached solver state is ${cacheState.status}, clearing broken cache`);
            await clearPersistedSolver(pyodide);
            cachedSolver = false;
          }

          if (cachedSolver) {
            const validCache = await validatePersistedSolver(pyodide);

            if (validCache) {
              log("Using cached solver packages from IndexedDB");
            } else {
              log("Cached solver validation failed, reinstalling");
              await writeCacheState(pyodide, { status: "broken" });
              await clearPersistedSolver(pyodide);
              cachedSolver = false;
            }
          }

          if (!cachedSolver) {
            await writeCacheState(pyodide, { status: "installing", version: SCRIPT_VERSION });
            notify("Loading Python solver packages...");
            await pyodide.loadPackage("micropip");

            const micropip = pyodide.pyimport("micropip") as {
              install: (packages: string[]) => Promise<void>;
              destroy?: () => void;
            };

            try {
              log(`Installing antlr4-python3-runtime==${ANTLR4_RUNTIME_VERSION}`);
              await micropip.install([`antlr4-python3-runtime==${ANTLR4_RUNTIME_VERSION}`]);

              log(`Installing latex2sympy2-extended[antlr4-13-2]==${EXTENDED_PARSER_VERSION}`);
              await micropip.install([`latex2sympy2-extended[antlr4-13-2]==${EXTENDED_PARSER_VERSION}`]);
            } finally {
              micropip.destroy?.();
            }

            await persistInstalledSolver(pyodide);
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
      async helloWorld(): Promise<string> {
        const pyodide = await getPyodide();
        return String(pyodide.runPython("'hello world from python'"));
      },

      async solveLatex(latexInput: string): Promise<string> {
        const pyodide = await ensureSolver();
        const globals = pyodide.globals as unknown as {
          set: (key: string, value: unknown) => void;
          delete: (key: string) => void;
        };

        globals.set("mathcha_input_latex", latexInput);
        try {
          const result = await pyodide.runPythonAsync("mathcha_solve_latex(mathcha_input_latex)");
          return String(result);
        } finally {
          globals.delete("mathcha_input_latex");
        }
      }
    };
  })();

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
              log("Menu item: Solve with Python clicked");
              const latex = await mathcha.copyToClipboard();
              const answer = await pythonRuntime.solveLatex(latex);
              const formattedAnswer = `$${answer}$`;
              log("Formatted answer:", formattedAnswer);
              GM_setClipboard(formattedAnswer);
              notify(`Answer: ${formattedAnswer}`);
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
        log("Auto-answer command triggered");
        const latex = await mathcha.copyToClipboard();
        log("LaTeX extracted:", latex);
        const answer = await pythonRuntime.solveLatex(latex);
        const formattedAnswer = `$${answer}$`;
        log("Formatted answer:", formattedAnswer);
        GM_setClipboard(formattedAnswer);
        notify(`Answer: ${formattedAnswer}`);
      } catch (error) {
        logError("Auto-answer error:", error);
        const message = error instanceof Error ? error.message : "Failed to solve LaTeX locally";
        notify(`Local Python solve error: ${message}`, true);
      }
    },

    pythonHello: async () => {
      try {
        const message = await pythonRuntime.helloWorld();
        log("Python hello result:", message);
        notify(message);
      } catch (error) {
        logError("Python hello error:", error);
        const message = error instanceof Error ? error.message : "Failed to run Python";
        notify(`Python runtime error: ${message}`, true);
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
        log("Answer shortcut pressed (Ctrl+Alt+/)");
        void commands.answer();
      } else if (event.key === config.aiShortcuts.pythonHello) {
        event.preventDefault();
        log("Python hello shortcut pressed (Ctrl+Alt+,)");
        void commands.pythonHello();
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
    void loadMathJax()
      .then(() => {
        notify("Mathcha Helper ready - Use Ctrl+Alt for AI features");
      })
      .catch(() => {
        notify("Mathcha Helper ready (LaTeX rendering not available)", true);
      });
  }
})();
