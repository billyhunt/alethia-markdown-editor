# Alethia agent instructions

## Leave the end-to-end suite to CI

Standing rule from Billy (2026-10-30). `npm run test:e2e` opens real app
windows that grab focus, and on Billy's Mac it locks up the desktop he is
working at. Agents do not run it locally:

- Locally, run `npm run typecheck`, `npm run lint` and `npm test`. Push, and
  let CI's "End-to-end on macOS" job run the suite; read its result.
- Run one end-to-end test locally only to debug a failure CI cannot explain,
  with `npx playwright test -g "<name>"`, never the whole suite.
- No throwaway scripts or probes that open Electron windows on screen. Use
  `show: false` or offscreen windows.
- Any local run waits for the machine-wide desktop-test lock
  (`e2e/desktopLock.ts`), shared with Tabula, so two suites never run at once.
