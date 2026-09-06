import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // CodeMirror needs a DOM for the view-level tests; the pure state and
    // main-process tests do not care either way.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/preload/**'],
    },
  },
})
