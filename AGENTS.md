# Alethia agent instructions

## Leave the end-to-end suite to CI

Standing rule from Billy (2026-10-30). `npm run test:e2e` opens real app
windows that grab focus, and on Billy's Mac it locks up the desktop he is
working at. Agents do not run it locally:

- Locally, run `npm run typecheck`, `npm run lint` and `npm test`. CI's
  "End-to-end on macOS" job runs the suite for every pull request and every
  push to `main` (not for a branch without a pull request): push to a branch
  with an open pull request and read its result there.
- Run one end-to-end test locally only to debug a failure CI cannot explain,
  with `npm run build && npx playwright test -g "<name>"`, never the whole
  suite.
- No throwaway scripts or probes that open Electron windows on screen. Use
  `show: false` or offscreen windows.
- Every local suite run first waits for the desktop-test lock
  (`e2e/desktopLock.mjs`: port 47390 on 127.0.0.1, shared with Tabula), so two
  never run at once.
