import { loadPyodide } from "pyodide";

const PARSER_VERSION = "1.11.0";
const ANTLR_VERSION = "4.13.2";
const command = process.argv[2] ?? "hello";
const latexInput = process.argv.slice(3).join(" ") || "2^{5} +2^{4} +2^{2} +2^{0}";

function log(...parts) {
  console.log("[pyodide-cli]", ...parts);
}

async function getPyodide() {
  log("loading pyodide runtime");
  return loadPyodide();
}

async function installExtendedParser(pyodide) {
  log("loading micropip");
  await pyodide.loadPackage("micropip");

  const micropip = pyodide.pyimport("micropip");
  try {
    log(`installing antlr4-python3-runtime==${ANTLR_VERSION}`);
    await micropip.install([`antlr4-python3-runtime==${ANTLR_VERSION}`]);

    log(`installing latex2sympy2-extended[antlr4-13-2]==${PARSER_VERSION}`);
    await micropip.install([`latex2sympy2-extended[antlr4-13-2]==${PARSER_VERSION}`]);
  } finally {
    micropip.destroy?.();
  }
}

async function bootstrapSolver(pyodide) {
  await installExtendedParser(pyodide);

  log("bootstrapping extended latex solver");
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
}

try {
  const pyodide = await getPyodide();

  if (command === "hello") {
    console.log(String(pyodide.runPython("'hello world from python'")));
    process.exit(0);
  }

  if (command === "install") {
    await installExtendedParser(pyodide);
    log("extended parser install finished");
    process.exit(0);
  }

  if (command === "solve") {
    await bootstrapSolver(pyodide);
    pyodide.globals.set("mathcha_input_latex", latexInput);
    try {
      const result = await pyodide.runPythonAsync("mathcha_solve_latex(mathcha_input_latex)");
      console.log(String(result));
    } finally {
      pyodide.globals.delete("mathcha_input_latex");
    }
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
} catch (error) {
  console.error("[pyodide-cli] error");
  console.error(error);
  process.exit(1);
}
