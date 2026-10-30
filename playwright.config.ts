import { defineConfig } from '@playwright/test'

/**
 * End-to-end user flows against the built app (`npm run build` first).
 *
 * One worker: every test launches a real Electron app, and window focus is a
 * property of the whole desktop, so parallel launches would steal it from one
 * another and make focus assertions meaningless. For the same reason the
 * global setup waits for any other desktop suite on this machine to finish.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/desktopLock.ts',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
})
