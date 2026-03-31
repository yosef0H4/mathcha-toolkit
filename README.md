# Mathcha Toolkit

Mathcha Toolkit is a Tampermonkey userscript for `mathcha.io` that adds a faster solve, import, export, and AI-assisted workflow on top of the editor.

## Features

- Copy selected Mathcha content as LaTeX.
- Import LaTeX back into Mathcha.
- Solve the selected expression with an in-browser Python runtime powered by Pyodide and SymPy.
- Insert formatted answers directly at the current Mathcha selection.
- Cycle answer formats between exact fraction, decimal, and mixed number.
- Convert integer results to another base using syntax like `\rightarrow _{2}`.
- Open the current selection in external tools and chat apps.
- Open Symbolab for step-by-step solving.

## Supported AI Links

- Claude
- ChatGPT
- Google AI Studio
- You.com
- Perplexity
- Grok
- Mistral Le Chat

These links are configured in [`src/config.ts`](/Z:/files/projects/js/mathcha enhancer/src/config.ts).

## Shortcuts

Hold `Ctrl+Alt` to show the shortcut tooltip inside Mathcha.

- `'` copy LaTeX
- `;` analyze with an AI tool
- `.` open in Symbolab
- `/` solve with Python and insert the answer
- `,` paste from LaTeX

## How It Works

The script prefers Mathcha runtime hooks over brittle menu automation when possible:

- runtime LaTeX extraction from the active editor selection
- direct import parsing through Mathcha's own LaTeX import logic
- in-browser solving through Pyodide, SymPy, and `latex2sympy2-extended`
- fallback DOM/menu paths when runtime access is unavailable

## Development

Install dependencies:

```bash
npm install
```

Useful commands:

```bash
npm run build
npm run typecheck
npm run pw:install
npm run pw:analyze
```

The userscript bundle is produced at [`dist/mathcha-toolkit.user.js`](/Z:/files/projects/js/mathcha enhancer/dist/mathcha-toolkit.user.js).

## Notes

- The script only activates on `https://*.mathcha.io/*`.
- Some external AI links are best-effort and may change over time.
- Playwright helpers and runtime investigation notes live under [playwright](/Z:/files/projects/js/mathcha enhancer/playwright) and [docs/mathcha-runtime-notes.md](/Z:/files/projects/js/mathcha enhancer/docs/mathcha-runtime-notes.md).
