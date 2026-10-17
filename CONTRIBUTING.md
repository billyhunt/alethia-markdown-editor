# Contributing to Alethia

Thanks for helping improve Alethia. Small, focused pull requests are easiest to
review and safest for the editor's file-preservation guarantees.

## Local setup

```bash
npm ci
npm run dev
```

Node 26 or newer, which is what CI uses; `.nvmrc` pins it.

Before opening a pull request, run what CI runs, so a red build is not the
first you hear of a problem:

```bash
npm run typecheck
npm run lint
npm run test:coverage   # coverage has a floor; plain `npm test` skips it
```

For a change that touches packaging, the build, or anything under `scripts/`:

```bash
npm run package         # unsigned .app in release/
npm run verify:package  # checks the bundle is structurally shippable (macOS only)
```

## Testing changes

Please add or update a regression test for changes to parsing, rendering,
formatting, file access, or document persistence. For UI changes, manually
check opening, editing, saving, Save As, a file changed externally, and closing
with unsaved changes.

Alethia deliberately preserves the document buffer. Avoid transformations that
rewrite source text merely to update its presentation.

## Pull requests

Describe the user-facing effect, link a relevant issue when one exists, and
keep unrelated formatting or refactors out of the same change. Never commit
files from `node_modules`, `dist`, `dist-electron`, `release`, or `coverage`.
