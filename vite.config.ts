import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { defineConfig, type Plugin } from 'vite'

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'none'"

// Production-only CSP. Dev must stay open for Vite's HMR client and the
// React Refresh preamble, both of which need inline scripts.
const cspPlugin: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
}

export default defineConfig({
  // Required: the packaged app loads the renderer over file://, so asset URLs
  // must be relative rather than root-absolute.
  base: './',
  plugins: [
    react(),
    cspPlugin,
    electron({
      main: {
        entry: { main: 'src/main/index.ts' },
        // Drop the plugin's default `--no-sandbox` so dev matches production.
        onstart: ({ startup }) => {
          void startup(['.'])
        },
        vite: { build: { outDir: 'dist-electron', sourcemap: true } },
      },
      preload: {
        input: { preload: 'src/preload/index.ts' },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: 'inline',
            // A sandboxed preload cannot be ESM. With "type": "module" the
            // plugin would emit preload.mjs, which Electron loads as ESM and
            // fails with "Unable to load preload script". Force CJS + .cjs.
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: '[name].cjs' },
            },
          },
        },
      },
    }),
  ],
})
