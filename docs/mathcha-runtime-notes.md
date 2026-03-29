# Mathcha Runtime Notes

## Scope

These notes capture the current reverse-engineering result for Mathcha's `Copy LaTeX` flow so the investigation can resume without redoing the same work.

Primary target:

- Replace the current DOM/context-menu driven `copyLatex` path in [src/script.ts](/Z:/files/projects/js/mathcha enhancer/src/script.ts) with a runtime-driven path.

Current status:

- Runtime editor discovery: solved
- Runtime LaTeX export invocation: solved
- Non-DOM replay for one known math sample in the welcome document: solved
- General arbitrary-selection mapping: not solved yet

## Current Userscript Path

The production userscript is still DOM-driven. It opens Mathcha's context menu and looks for the `Copy LaTeX` item.

Relevant file:

- [src/script.ts](/Z:/files/projects/js/mathcha enhancer/src/script.ts#L177)

That remains the fallback path for now.

## Proven Runtime Chain

The real `Copy LaTeX` logic is not in the menu itself. The menu is only a trigger.

Bundle evidence from [latex words/1.js](/Z:/files/projects/js/mathcha enhancer/latex words/1.js):

- `copy-latex` menu item calls `requestCopyLatex(...)`
- `requestCopyLatex(ignoreSpace)` calls `latexIoHandler.getSelectedLatex('latex-latex', ignoreSpace)`
- `getSelectedLatex(...)` calls `getController().getSelectionData(getContainerModel(), true)`
- the selected model is converted with `getConverter('latex-latex').toLatex(...)`

Key bundle regions:

- `71161-71175`: menu `copy-latex`
- `71794-71798`: `requestCopyLatex`
- `61008-61024`: `getSelectedLatex`
- `60994-61003`: converter lookup
- `61504-61518`: `executeCopy()` text-only path, not LaTeX
- `91935-91976`: editor instance wiring
- `93409-93557`: public delegation methods

Important distinction:

- `copyPasteHandler.executeCopy()` is plain/text-oriented and is not the same path as `Copy LaTeX`
- the real LaTeX path is `latexIoHandler.getSelectedLatex('latex-latex', false)`

## Live Runtime Hook

The stable live editor hook discovered so far is:

- `document.querySelector('math-type').reactInstance`

That object is the actual editor instance. In the current bundle it is an instance whose constructor name shows as `Fp`.

Useful runtime surfaces on that instance:

- `latexIoHandler`
- `copyPasteHandler`
- `contextMenuHandler`
- `getContainerModel()`
- `getController()`
- `getSelectedJson()`
- `setSelected(...)`
- `setSelection(...)`
- `extendSelection(...)`
- `clearSelection()`
- `setCursorInputFocus(...)`
- `setCursorMathTypeFocus(...)`

This is now used as the primary discovery hook in:

- [playwright/support.mjs](/Z:/files/projects/js/mathcha enhancer/playwright/support.mjs)

## Wrapper Chain

The runtime wrapper chain observed from React internals is:

- `Mv -> Ev -> jh -> Fp`

Or, in field terms:

- outer wrapper with `docRef`
- nested wrapper with `docRef`
- document container with `mathType`
- editor instance with `latexIoHandler`

This is useful context, but `math-type.reactInstance` is the simplest live access point.

## What Plain Text Selection Looks Like

From a real interaction on the welcome document text:

- click prompt line
- `Tab`
- `ArrowRight`
- `Shift+ArrowRight`

Mathcha calls:

```js
setSelected({ lineIndex: 3, charIndex: 19 })
extendSelection({ lineIndex: 3, charIndex: 20 })
```

That produces:

- LaTeX: `\\begin{center}\nt\n\\end{center}\n`
- selected JSON containing text block `"t"`

This confirmed that root text selection is simple line/char selection.

## What Math Selection Looks Like

From a real click on the inline welcome-document math container, then a click on the over-arrow symbol over `F`, then `Shift+ArrowRight`, Mathcha uses a nested selection object.

Single cursor inside inline math:

```js
{
  key: "mathValue",
  selected: {
    key: "value",
    selected: {
      lineIndex: 0,
      charIndex: 0
    },
    lineIndex: 0,
    charIndex: 0
  },
  lineIndex: 3,
  charIndex: 39
}
```

Extended range selecting `F`:

Start:

```js
{
  key: "mathValue",
  selected: {
    key: "value",
    selected: {
      lineIndex: 0,
      charIndex: 0
    },
    lineIndex: 0,
    charIndex: 0
  },
  lineIndex: 3,
  charIndex: 39
}
```

End:

```js
{
  key: "mathValue",
  selected: {
    key: "value",
    selected: {
      lineIndex: 0,
      charIndex: 1
    },
    lineIndex: 0,
    charIndex: 0
  },
  lineIndex: 3,
  charIndex: 39
}
```

Important observation:

- `setSelected(start)` followed by `extendSelection(end)` did not replay reliably in a cold injected path
- `setSelection(start, end)` did replay reliably

Working direct runtime replay:

```js
const inst = document.querySelector("math-type").reactInstance;

inst.clearSelection();
inst.setCursorInputFocus(true);
inst.setCursorMathTypeFocus(true);
inst.setSelection(start, end);

const latex = inst.latexIoHandler.getSelectedLatex("latex-latex", false);
```

Observed result:

- `latex === "F"`

This is the first fully proven non-DOM selection + export path.

## Playwright Harness State

Relevant files:

- [playwright/support.mjs](/Z:/files/projects/js/mathcha enhancer/playwright/support.mjs)
- [playwright/runtime-direct.spec.js](/Z:/files/projects/js/mathcha enhancer/playwright/runtime-direct.spec.js)

Current proven test:

- `npm run pw:runtime:direct`

That spec now proves:

- runtime editor discovery
- direct `latexIoHandler.getSelectedLatex(...)`
- non-DOM replay of a known inline math selection from the welcome document

## What Is Still Missing

The unresolved problem is not LaTeX export anymore. It is general selection construction.

Still missing:

- derive the nested selection payload automatically for an arbitrary clicked/current math node
- map DOM/math content or document model nodes to runtime selection objects without relying on the context menu
- replace the userscript path with:
  - runtime path first
  - DOM/context-menu path as fallback

## Best Current Direction

Next loop should focus on one of these:

1. Capture selection payloads from real clicks on different math nodes and derive a payload builder.
2. Inspect whether `compositeblock` / `editarea` runtime instances expose editor info or cursor coordinates that can be transformed into a `setSelection(...)` payload.
3. Map the active document model from `api/documents/active2` to the nested selection payload shape.

Avoid:

- broad bundle scans
- arbitrary module execution
- returning to DOM menu clicking as the primary strategy

## Supporting Artifacts

Recent generated reports:

- [mathcha-runtime-direct-2026-03-29T16-20-18-850Z.json](/Z:/files/projects/js/mathcha enhancer/playwright-output/reports/mathcha-runtime-direct-2026-03-29T16-20-18-850Z.json)
- [mathcha-runtime-direct-2026-03-29T16-20-18-850Z.md](/Z:/files/projects/js/mathcha enhancer/playwright-output/reports/mathcha-runtime-direct-2026-03-29T16-20-18-850Z.md)

These are not the long-term source of truth; this document is.
