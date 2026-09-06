# Contributing to Alethia

Thanks for helping improve Alethia. Small, focused pull requests are easiest to
review and safest for the editor's file-preservation guarantees.

## Local setup

```bash
npm ci
npm run dev
```

Before opening a pull request, run the checks that apply to your change:

```bash
npm test
npm run lint
npm run build
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
