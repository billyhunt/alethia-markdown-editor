# Third-party notices

Alethia is MIT licensed (see `LICENSE`). It bundles the following.

## Fonts — SIL Open Font License 1.1

These typefaces are **embedded in the application binary**, not fetched at
runtime, so the OFL's redistribution terms apply to every copy of Alethia.
Full licence texts are in `licenses/`.

| Font | Copyright | Licence |
|---|---|---|
| Archivo | 2020 The Archivo Project Authors ([Omnibus-Type/Archivo](https://github.com/Omnibus-Type/Archivo)) | [OFL-1.1](licenses/OFL-archivo.txt) |
| Archivo Black | 2017 The Archivo Black Project Authors ([Omnibus-Type/ArchivoBlack](https://github.com/Omnibus-Type/ArchivoBlack)) | [OFL-1.1](licenses/OFL-archivo-black.txt) |
| DM Mono | 2020 The DM Mono Project Authors ([googlefonts/dm-mono](https://github.com/googlefonts/dm-mono)) | [OFL-1.1](licenses/OFL-dm-mono.txt) |

Under the OFL these fonts may be bundled and redistributed freely, including
commercially. Two conditions matter in practice: the licence and copyright
notice must accompany the fonts (which is what this file and `licenses/` are
for), and the fonts may not be sold on their own. The OFL also forbids using
the Reserved Font Names to describe a modified version — Alethia ships them
unmodified, so that does not arise.

## Libraries — MIT

Editor and runtime: `@codemirror/*`, `@lezer/*`, `react`, `react-dom`,
`zustand`, `chokidar`, `katex`.

Build and packaging: `electron`, `vite`, `vite-plugin-electron`,
`electron-builder`, `typescript`, `oxlint`.

Each is MIT licensed; see the `LICENSE` file inside its package under
`node_modules/`.

## Electron and Chromium

Alethia is built on [Electron](https://electronjs.org), which is MIT
licensed and embeds Chromium and Node.js. Chromium carries its own BSD-style
licence and additional third-party notices, viewable in any Chromium build.
