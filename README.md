# Alethia

A Typora-style markdown editor for macOS: a single editing surface where
markdown renders in place, and the raw syntax reappears only around whatever
the caret is touching. No split pane, no preview toggle.

## Running it

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches Electron against it, with hot reload for
the renderer and an automatic restart when main-process code changes.

## Building

```bash
npm run package   # unsigned .app in release/mac-arm64/
npm run dist      # .dmg (requires a Developer ID certificate)
```

`npm run package` produces an unsigned build for local use. macOS may refuse to
open it on first launch; `codesign --force --deep --sign - "release/mac-arm64/Alethia.app"`
clears that. Signing and notarization are configured but off — see the comment
in `electron-builder.yml`.

## Architecture

Three processes, split under `src/`:

| Directory | Runs in | Purpose |
|---|---|---|
| `src/main/` | Electron main | Windows, menus, file I/O, watchers, settings |
| `src/preload/` | Preload (sandboxed) | The only place `ipcRenderer` is touched |
| `src/renderer/` | Chromium | React shell and the CodeMirror editor |
| `src/shared/` | Both | Types and channel names, no runtime imports |

**The editor** is CodeMirror 6. The document *is* the markdown text; rendering
is a decoration layer over it. That means an untouched file round-trips
byte-identical, and undo, IME and nested-language highlighting all keep working
because nothing rewrites the buffer. `src/renderer/editor/extensions/` holds the
decoration passes: `inlineDecorations` for anything within a line,
`blockDecorations` for tables and display math (a multi-line replacement changes
line structure, which CodeMirror forbids a ViewPlugin from doing).

**Security.** The renderer runs with `contextIsolation` on, `nodeIntegration`
off and `sandbox` on, and cannot reach the filesystem directly. Main keeps a
grant registry (`src/main/paths.ts`): a path is only readable once it arrived
from a source main controls — a dialog, an `open-file` event, argv, a validated
drop, or an opened folder. Reads are limited to markdown and text, writes to
markdown, and writes inside `userData` are refused.

## What works

Live preview for headings, bold, italic, strikethrough, inline code, escapes,
links, bare URLs, horizontal rules, blockquotes, nested bullet and ordered
lists, task checkboxes, fenced code with per-language highlighting, GFM tables,
`$…$` and `$$…$$` math via KaTeX, and YAML front matter.

Around it: open/save/save-as with dirty tracking, a folder sidebar and heading
outline, live word and character counts, recent files, session restore,
external-change detection, focus and typewriter modes, and a native menu whose
accelerators drive the same commands.

## Known limitations

- **Tables are not a grid while editing.** The caret inside a table shows the
  raw pipes, with Tab moving between cells; it renders as a table when the caret
  leaves. There is no column resize or add/delete-column UI.
- **Block syntax reveals per line, not per node.** A heading shows its `#`
  whenever the caret is anywhere on that line.
- **The caret shifts visually** when a node reveals its markers, because those
  characters were always in the document. Typora behaves the same way.
- **Raw HTML blocks are shown as source**, never rendered.
- **Relative image paths are not resolved yet** — that needs a custom protocol
  handler, since the CSP blocks `file:` images.
- **There are no automated tests.** The security boundary and the reveal engine
  were verified by scripted assertions during development, but nothing pins that
  behaviour down against regressions.
