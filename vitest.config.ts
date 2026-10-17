import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CodeMirror needs a DOM for the view-level tests; the pure state and
    // main-process tests do not care either way.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Include .tsx. Excluding it hid all 11 renderer components, so the
      // reported percentage described only the non-React slice and no amount
      // of untested UI could ever trip the floor.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/preload/**'],
      // json-summary feeds the CI coverage table; text keeps the local run
      // readable.
      reporter: ['text', 'json-summary', 'html'],
      // A floor a few points under where coverage stands, not a target. It
      // exists to catch a large regression -- deleting a test file, or adding
      // a big untested module -- without turning every change into a coverage
      // negotiation.
      thresholds: {
        statements: 26,
        branches: 23,
        functions: 23,
        lines: 26,
      },
    },
  },
})
