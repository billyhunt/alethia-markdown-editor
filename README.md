# Alethia

A markdown editor for macOS with one editing surface. Your markdown renders in
place as you write, and the raw syntax reappears only around whatever the caret
is touching — no split pane, no preview toggle, no mode to switch.

The name is ἀλήθεια: disclosure, the state of not being hidden. The source is
never converted or hidden away; it is simply covered, and uncovers itself where
you are working.

![The editor with the file tree, format bar and a document showing headings, a
quote, task list, table and highlighted code](docs/screenshots/editor-light.png)

Every save keeps the version it replaced, browsable per file:

![The History panel listing earlier versions of the open file with relative
timestamps and sizes](docs/screenshots/history.png)

It follows the system appearance:

![The same document in dark mode, with the chrome inverted to cream on
black](docs/screenshots/editor-dark.png)

## Running it

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches Electron against it, with hot reload for
the renderer and an automatic restart when main-process code changes.

A `postinstall` step renames the development Electron bundle to Alethia and
gives it the app icon. macOS reads the launched bundle's `Info.plist` before
any application code runs, so without it the menu bar, Cmd-Tab and Dock all
say "Electron" no matter what the app calls itself. `npm install` restores the
stock bundle, which is why the step re-runs each time. Packaged builds need
none of this.

## Example documents

Open these files in Alethia to see its rendering, or browse their Markdown on GitHub:

| Document | What it shows |
|---|---|
| [Welcome tour](public/sample.md) | A larger observing table, inline formatting, lists, code, and a first equation |
| [Formula notebook](public/examples/formula-notebook.md) | Inline and display math, aligned equations, sums, matrices, and an integral |
| [Project notes](public/examples/project-notes.md) | YAML front matter, a project board, nested checklists, heading levels, and code in three languages |

Open `public` with **Cmd+Shift+O** to browse all three from the sidebar. The welcome
tour also appears when the app starts without a saved document to restore.
Click into a rendered table or equation to edit its source, then move the caret
away to see it rendered again. The example files are bundled with packaged builds.

## Building

```bash
npm test          # unit and regression suite
npm run package   # unsigned Apple-silicon .app in release/mac-arm64/
npm run dist      # unsigned Apple-silicon .dmg in release/
```

`npm run package` is a local smoke-test build, not a distributable release.
Before distributing outside the App Store, configure Developer ID signing,
hardened runtime, entitlements, and notarization. A Mac App Store build needs a
separate provisioning profile, App Sandbox entitlements, a release version, and
a monotonically increasing Mac build number; those credentials and release
choices are intentionally not stored in this repository.

## Opening markdown files with Alethia

The app declares itself a handler for `.md`, `.markdown`, `.mdown` and `.mkd`.
Declaring it is not the same as being chosen, though: macOS keeps its own
binding and leaves an existing one alone.

To make it the default, right-click any markdown file in Finder, choose **Get
Info**, pick Alethia under *Open with*, then **Change All…**.

Note that a development run and an installed copy share one instance lock and
one settings directory, because both are called Alethia. Quit one before
launching the other, or the second will hand its file to the first and exit.

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

Around it: open/save/save-as with dirty tracking, autosave, per-file version
history, a folder sidebar with rename/reveal/trash, a heading outline, live word
and character counts, recent files, session restore, external-change detection,
printing and PDF export, focus and typewriter modes, and a native menu whose
accelerators drive the same commands.

Files keep the line endings they arrived with, so opening and saving a CRLF
document does not rewrite every line.

## Known limitations

- **Tables are not a grid while editing.** The caret inside a table shows the
  raw pipes, with Tab moving between cells; it renders as a table when the caret
  leaves. There is no column resize or add/delete-column UI.
- **Block syntax reveals per line, not per node.** A heading shows its `#`
  whenever the caret is anywhere on that line.
- **The caret shifts visually** when a node reveals its markers, because those
  characters were always in the document rather than being inserted.
- **Raw HTML blocks are shown as source**, never rendered.
- **Relative image paths are not resolved yet** — that needs a custom protocol
  handler, since the CSP blocks `file:` images.
- **The automated suite covers core regressions, not every workflow.** It
  exercises markdown recognition, live-preview reveal logic, formatting,
  document statistics, table navigation, path grants, and line-ending
  preservation. Native file dialogs, printing, session restore, and external
  file-change prompts still need manual release testing.
