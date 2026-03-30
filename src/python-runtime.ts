import {
  ANTLR4_RUNTIME_VERSION,
  EXTENDED_PARSER_VERSION,
  PERSIST_ACTIVE_ROOT,
  PERSIST_ACTIVE_SITE_PACKAGES,
  PERSIST_BACKUP_ROOT,
  PERSIST_ROOT,
  PERSIST_STAGING_ROOT,
  PERSIST_STAGING_SITE_PACKAGES,
  PERSIST_STATE_FILE,
  PYODIDE_INDEX_URL,
  PYODIDE_SCRIPT_URL,
  SCRIPT_VERSION
} from "./config";
import type { LogFn, NotifyFn, PyodideInterface, PyodideWindow, PythonRuntime, SolverResult } from "./types";

type CacheState = { status: "empty" | "installing" | "ready" | "broken"; version?: string };

export function createPythonRuntime({
  pageWindow,
  log,
  notify
}: {
  pageWindow: PyodideWindow;
  log: LogFn;
  notify: NotifyFn;
}): PythonRuntime {
  let pyodidePromise: Promise<PyodideInterface> | null = null;
  let scriptLoadPromise: Promise<void> | null = null;
  let solverPromise: Promise<void> | null = null;
  let persistentFsPromise: Promise<void> | null = null;

  const syncFs = async (pyodide: PyodideInterface, populate: boolean): Promise<void> => {
    const fs = pyodide.FS as { syncfs: (populateArg: boolean, callback: (error?: Error | null) => void) => void };
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

        if (!fs.analyzePath(PERSIST_ROOT).exists) fs.mkdir(PERSIST_ROOT);
        for (const dir of [PERSIST_ACTIVE_ROOT, PERSIST_STAGING_ROOT, PERSIST_BACKUP_ROOT]) {
          if (!fs.analyzePath(dir).exists) fs.mkdir(dir);
        }
        for (const dir of [PERSIST_ACTIVE_SITE_PACKAGES, PERSIST_STAGING_SITE_PACKAGES]) {
          if (!fs.analyzePath(dir).exists) fs.mkdir(dir);
        }

        try {
          fs.mount(fs.filesystems.IDBFS, { root: "." }, PERSIST_ROOT);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("already mounted")) throw error;
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

  const readCacheState = async (pyodide: PyodideInterface): Promise<CacheState> => {
    const fs = pyodide.FS as {
      analyzePath: (path: string) => { exists: boolean };
      readFile: (path: string, opts: { encoding: "utf8" }) => string;
    };

    if (!fs.analyzePath(PERSIST_STATE_FILE).exists) {
      return { status: "empty" };
    }

    try {
      return JSON.parse(fs.readFile(PERSIST_STATE_FILE, { encoding: "utf8" })) as CacheState;
    } catch {
      return { status: "broken" };
    }
  };

  const writeCacheState = async (pyodide: PyodideInterface, state: CacheState): Promise<void> => {
    const fs = pyodide.FS as { writeFile: (path: string, data: string) => void };
    fs.writeFile(PERSIST_STATE_FILE, JSON.stringify(state));
    await syncFs(pyodide, false);
  };

  const ensurePersistentImports = async (pyodide: PyodideInterface): Promise<void> => {
    await pyodide.runPythonAsync(`
import importlib
import sys

cache_path = "${PERSIST_ACTIVE_SITE_PACKAGES}"
if cache_path not in sys.path:
    sys.path.insert(0, cache_path)
importlib.invalidate_caches()
`);
  };

  const suspendActiveCacheImports = async (pyodide: PyodideInterface): Promise<void> => {
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

  const restoreActiveCacheImports = async (pyodide: PyodideInterface): Promise<void> => {
    await pyodide.runPythonAsync(`
import importlib
import sys

active_cache_path = "${PERSIST_ACTIVE_SITE_PACKAGES}"

if active_cache_path not in sys.path:
    sys.path.insert(0, active_cache_path)

importlib.invalidate_caches()
`);
  };

  const validateRuntimeSolverSmokeTest = async (pyodide: PyodideInterface): Promise<{ ok: boolean; error?: string }> => {
    const result = await pyodide.runPythonAsync(`
import json

try:
    solver_result = mathcha_solve_latex(r"2^{5} + 2^{4} + 2^{2} + 2^{0}")
    parsed = json.loads(solver_result)
    assert parsed["latex"] == "53"
    assert parsed["is_rational"] is True
    assert parsed["numerator"] == "53"
    assert parsed["denominator"] == "1"
    validation_result = json.dumps({"ok": True})
except Exception as error:
    validation_result = json.dumps({"ok": False, "error": repr(error)})

validation_result
`);
    return JSON.parse(String(result)) as { ok: boolean; error?: string };
  };

  const hasPersistedSolverFiles = (pyodide: PyodideInterface): boolean => {
    const fs = pyodide.FS as { analyzePath: (path: string) => { exists: boolean } };
    return [
      `${PERSIST_ACTIVE_SITE_PACKAGES}/latex2sympy2_extended`,
      `${PERSIST_ACTIVE_SITE_PACKAGES}/antlr4`,
      `${PERSIST_ACTIVE_SITE_PACKAGES}/antlr4_python3_runtime-${ANTLR4_RUNTIME_VERSION}.dist-info`,
      `${PERSIST_ACTIVE_SITE_PACKAGES}/latex2sympy2_extended-${EXTENDED_PARSER_VERSION}.dist-info`
    ].every((path) => fs.analyzePath(path).exists);
  };

  const validatePersistedSolver = async (pyodide: PyodideInterface): Promise<{ ok: boolean; error?: string }> => {
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
    return JSON.parse(String(result)) as { ok: boolean; error?: string };
  };

  const clearStagingSolver = async (pyodide: PyodideInterface): Promise<void> => {
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

  const stageInstalledSolver = async (pyodide: PyodideInterface): Promise<void> => {
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

  const promoteStagedSolver = async (pyodide: PyodideInterface): Promise<void> => {
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

  const validateStagedSolver = async (pyodide: PyodideInterface): Promise<{ ok: boolean; error?: string }> => {
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
    return JSON.parse(String(result)) as { ok: boolean; error?: string };
  };

  const ensurePyodideScript = async (): Promise<void> => {
    if (typeof pageWindow.loadPyodide === "function") return;

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

          const micropip = pyodide.pyimport("micropip") as {
            install: (packages: string[], options?: { reinstall?: boolean }) => Promise<void>;
            destroy?: () => void;
          };

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
              throw new Error(`Staged solver cache validation failed: ${validStagedCache.error ?? "unknown reason"}`);
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
import json

from latex2sympy2_extended import latex2sympy
from sympy import simplify, latex

def mathcha_solve_latex(input_latex):
    expr = latex2sympy(input_latex)
    result = simplify(expr.doit().doit())
    payload = {
        "latex": latex(result),
        "is_rational": bool(getattr(result, "is_rational", False)),
        "numerator": None,
        "denominator": None,
        "decimal": None,
    }
    if payload["is_rational"]:
        numerator, denominator = result.as_numer_denom()
        payload["numerator"] = str(int(numerator))
        payload["denominator"] = str(int(denominator))
    return json.dumps(payload)
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
    async helloWorld(): Promise<string> {
      const pyodide = await getPyodide();
      return String(pyodide.runPython("'hello world from python'"));
    },

    async solveLatex(latexInput: string): Promise<SolverResult> {
      const pyodide = await ensureSolver();
      const globals = pyodide.globals as unknown as {
        set: (key: string, value: unknown) => void;
        delete: (key: string) => void;
      };

      globals.set("mathcha_input_latex", latexInput);
      try {
        const result = await pyodide.runPythonAsync("mathcha_solve_latex(mathcha_input_latex)");
        const parsed = JSON.parse(String(result)) as {
          latex?: unknown;
          is_rational?: unknown;
          numerator?: unknown;
          denominator?: unknown;
          decimal?: unknown;
        };
        return {
          latex: typeof parsed.latex === "string" ? parsed.latex : "",
          isRational: Boolean(parsed.is_rational),
          numerator: typeof parsed.numerator === "string" ? parsed.numerator : null,
          denominator: typeof parsed.denominator === "string" ? parsed.denominator : null,
          decimal: typeof parsed.decimal === "string" ? parsed.decimal : null
        };
      } finally {
        globals.delete("mathcha_input_latex");
      }
    },

    async warmup(): Promise<void> {
      const pyodide = await getPyodide();
      const hello = String(pyodide.runPython("'hello world from python'"));
      log("Python startup test passed:", hello);
      await ensureSolver();
    }
  };
}
