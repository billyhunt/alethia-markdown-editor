import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The verifier is a release gate, so what matters is not that it passes on a
 * good bundle but that it fails on every broken one. These build asar
 * archives and .app bundles by hand so each failure mode can be produced
 * deliberately, without a 40-second electron-builder run.
 */

const SCRIPT = path.resolve(__dirname, '../../scripts/verify-package.mjs')

/**
 * Reading the bundle identity needs `plutil`, which exists only on macOS, so
 * the cases that depend on it cannot run in the Linux CI job. The verifier
 * says so plainly instead of reporting the keys as missing, and that message
 * is asserted below so the skip cannot hide a real regression.
 */
const onMac = process.platform === 'darwin'

let dir = ''

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Alethia</string>
  <key>CFBundleIdentifier</key><string>com.billyhunt.alethia</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Markdown Document</string>
      <key>CFBundleTypeExtensions</key>
      <array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string></array>
    </dict>
  </array>
</dict>
</plist>
`

const INDEX_HTML = '<!doctype html><html><head>' +
  '<link rel="stylesheet" href="./assets/app.css" />' +
  '</head><body><script type="module" src="./assets/app.js"></script></body></html>'

/** Everything a good bundle contains, as packaged-path -> contents. */
function goodFiles(): Record<string, string> {
  return {
    '/dist/index.html': INDEX_HTML,
    '/dist/assets/app.js': 'console.log("renderer")',
    '/dist/assets/app.css': 'body { color: black }',
    // The OFL fonts arrive as hashed assets, so the licence files alone do
    // not prove the fonts they cover actually shipped.
    '/dist/assets/archivo-latin-400-normal.woff2': 'font bytes',
    '/dist-electron/main.js': 'require("electron")',
    '/dist-electron/preload.cjs': 'contextBridge.exposeInMainWorld()',
    '/package.json': '{"name":"alethia"}',
    '/LICENSE': 'MIT',
    '/THIRD_PARTY_NOTICES.md': 'notices',
    '/licenses/OFL-archivo.txt': 'OFL',
    '/licenses/OFL-archivo-black.txt': 'OFL',
    '/licenses/OFL-dm-mono.txt': 'OFL',
  }
}

/** Writes a real asar: four uint32s, a padded JSON index, then the data. */
function writeAsar(target: string, files: Record<string, string>, options: { truncate?: boolean } = {}): void {
  const index: { files: Record<string, unknown> } = { files: {} }
  const blobs: Buffer[] = []
  let offset = 0

  for (const [at, contents] of Object.entries(files)) {
    const blob = Buffer.from(contents, 'utf8')
    const parts = at.replace(/^\//, '').split('/')
    let node = index
    for (const part of parts.slice(0, -1)) {
      node.files[part] ??= { files: {} }
      node = node.files[part] as { files: Record<string, unknown> }
    }
    node.files[parts.at(-1) as string] = { size: blob.length, offset: String(offset) }
    blobs.push(blob)
    offset += blob.length
  }

  const json = Buffer.from(JSON.stringify(index), 'utf8')
  const padded = Math.ceil(json.length / 4) * 4
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(padded + 8, 4)
  prefix.writeUInt32LE(padded + 4, 8)
  prefix.writeUInt32LE(json.length, 12)

  const body = Buffer.concat(blobs)
  const whole = Buffer.concat([prefix, json, Buffer.alloc(padded - json.length), body])
  // A build interrupted partway leaves a complete index and missing data.
  fs.writeFileSync(target, options.truncate ? whole.subarray(0, whole.length - body.length) : whole)
}

interface BundleOptions {
  files?: Record<string, string>
  plist?: string | null
  executable?: boolean
  asar?: boolean
  truncate?: boolean
}

function bundle(name: string, options: BundleOptions = {}): string {
  const app = path.join(dir, `${name}.app`)
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true })
  fs.mkdirSync(path.join(app, 'Contents/Resources'), { recursive: true })

  if (options.executable !== false) {
    const exe = path.join(app, 'Contents/MacOS/Alethia')
    fs.writeFileSync(exe, '#!/bin/sh\n')
    fs.chmodSync(exe, 0o755)
  }
  if (options.plist !== null) {
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), options.plist ?? PLIST)
  }
  if (options.asar !== false) {
    writeAsar(path.join(app, 'Contents/Resources/app.asar'), options.files ?? goodFiles(), {
      truncate: options.truncate,
    })
  }
  return app
}

/** Runs the verifier, returning its exit code and combined output. */
function verify(app?: string, cwd?: string): { code: number; output: string } {
  try {
    const stdout = execFileSync('node', app === undefined ? [SCRIPT] : [SCRIPT, app], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd,
    })
    return { code: 0, output: stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alethia-verify-'))
})

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true })
})

describe('verify-package on a sound bundle', () => {
  it.skipIf(!onMac)('passes', () => {
    const result = verify(bundle('good'))
    expect(result.output).toContain('looks shippable')
    expect(result.code).toBe(0)
  })

  it.skipIf(onMac)('refuses to pass judgement without plutil', () => {
    // Off macOS the verifier must fail loudly rather than quietly skipping
    // the identity checks and calling the bundle shippable.
    const result = verify(bundle('good'))
    expect(result.code).toBe(1)
    expect(result.output).toContain('plutil is unavailable')
  })
})

describe('verify-package default bundle selection', () => {
  /** Lays out `release/<directory>/Alethia.app`, packaged `ageSeconds` ago. */
  function release(directory: string, ageSeconds: number): void {
    const app = bundle(`release/${directory}/Alethia`)
    const when = new Date(Date.now() - ageSeconds * 1000)
    fs.utimesSync(path.join(app, 'Contents/Resources/app.asar'), when, when)
  }

  it('verifies the freshest bundle, not whichever directory sorts first', () => {
    // `release/` is never cleaned, so stale output sits beside the fresh
    // build. Both stale names sort before and after `mac-universal`.
    release('mac', 3000)
    release('mac-arm64', 2000)
    release('mac-universal', 10)
    const result = verify(undefined, dir)
    expect(result.output).toContain(`Verifying ${path.join('release', 'mac-universal', 'Alethia.app')}`)
  })

  it('does not let a stale native-arch bundle beat a fresher one', () => {
    release('mac-arm64', 3000)
    release('mac', 3000)
    release('mac-universal', 5)
    const result = verify(undefined, dir)
    expect(result.output).toContain(`Verifying ${path.join('release', 'mac-universal', 'Alethia.app')}`)
  })

  it('breaks an exact tie by name, independent of listing order', () => {
    release('mac-universal', 100)
    release('mac-x64', 100)
    const asars = ['mac-universal', 'mac-x64'].map((d) =>
      path.join(dir, 'release', d, 'Alethia.app/Contents/Resources/app.asar'),
    )
    const when = fs.statSync(asars[0]).mtime
    for (const asar of asars) fs.utimesSync(asar, when, when)
    const result = verify(undefined, dir)
    // Neither is native, so the name decides.
    expect(result.output).toContain(`Verifying ${path.join('release', 'mac-universal', 'Alethia.app')}`)
  })

  it('still honours an explicit path over anything in release/', () => {
    release('mac-universal', 10)
    const explicit = bundle('chosen')
    const result = verify(explicit, dir)
    expect(result.output).toContain(`Verifying ${explicit}`)
  })
})

describe('verify-package on broken bundles', () => {
  it('fails when there is no bundle at all', () => {
    const result = verify(path.join(dir, 'absent.app'))
    expect(result.code).toBe(1)
    expect(result.output).toContain('No app bundle')
  })

  it('fails without an executable', () => {
    const result = verify(bundle('headless', { executable: false }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('no executable')
  })

  it('fails without an Info.plist', () => {
    const result = verify(bundle('plistless', { plist: null }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('no Info.plist')
  })

  it.skipIf(!onMac)('fails when the bundle identity is wrong', () => {
    const wrong = PLIST.replace('com.billyhunt.alethia', 'com.example.someoneelse')
    const result = verify(bundle('misidentified', { plist: wrong }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('CFBundleIdentifier')
  })

  it.skipIf(!onMac)('fails when the markdown claim is narrowed, not just absent', () => {
    // The whole point of the declaration is Finder's Open With list. A build
    // that keeps the key but drops extensions would pass a presence check.
    const narrowed = PLIST.replace(
      '<string>mdown</string><string>mkd</string>',
      '',
    )
    const result = verify(bundle('narrowed', { plist: narrowed }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('does not claim .mdown')
  })

  it('fails without an app.asar', () => {
    const result = verify(bundle('unpacked', { asar: false }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('no app.asar')
  })

  it('fails when the preload is missing', () => {
    // Loaded by name in windows.ts; without it the app opens a dead window
    // while every other check still passes.
    const files = goodFiles()
    delete files['/dist-electron/preload.cjs']
    const result = verify(bundle('preloadless', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('missing /dist-electron/preload.cjs')
  })

  it('fails when the preload was emitted as ESM', () => {
    // Electron loads preload.cjs as CommonJS whatever it contains, so an
    // `export` is a SyntaxError there. The file exists and is non-empty, so
    // presence and size checks both pass it while the renderer loses its
    // API bridge.
    for (const esm of ['export {}', 'import { contextBridge } from "electron"\ncontextBridge.exposeInMainWorld("a", {})']) {
      const files = goodFiles()
      files['/dist-electron/preload.cjs'] = esm
      const result = verify(bundle('esm-preload', { files }))
      expect(result.code).toBe(1)
      expect(result.output).toContain('/dist-electron/preload.cjs is not valid CommonJS')
    }
  })

  it('accepts a CommonJS preload that uses require and module.exports', () => {
    const files = goodFiles()
    files['/dist-electron/preload.cjs'] =
      '"use strict";\nconst { contextBridge } = require("electron");\ncontextBridge.exposeInMainWorld("a", {});\nmodule.exports = {};'
    const result = verify(bundle('cjs-preload', { files }))
    expect(result.output).not.toContain('not valid CommonJS')
  })

  it('fails when a font licence is missing', () => {
    const files = goodFiles()
    delete files['/licenses/OFL-dm-mono.txt']
    const result = verify(bundle('unlicensed', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('OFL-dm-mono.txt')
  })

  it('fails when index.html points at an asset that was not packaged', () => {
    // The renderer bundle is hashed, so a stale or partial build produces
    // exactly this: an index.html referencing a file that is not there.
    const files = goodFiles()
    delete files['/dist/assets/app.js']
    const result = verify(bundle('assetless', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('app.js, which is not packaged')
  })

  it('fails when the archive is truncated after its index', () => {
    // Every required path is still listed; only the bytes are gone. A
    // filename-only check calls this shippable.
    const result = verify(bundle('truncated', { truncate: true }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('/dist/index.html runs past the end of the archive')
  })

  it('fails when the asar is not an asar', () => {
    const app = bundle('bogus')
    fs.writeFileSync(path.join(app, 'Contents/Resources/app.asar'), 'not an archive at all')
    const result = verify(app)
    expect(result.code).toBe(1)
    expect(result.output).toContain('unreadable')
  })

  it('fails when the renderer bundle is missing entirely', () => {
    // index.html can reference nothing and still be present; a build that
    // emitted no renderer chunk has to fail.
    const files = goodFiles()
    delete files['/dist/assets/app.js']
    files['/dist/index.html'] = '<!doctype html><html><body></body></html>'
    const result = verify(bundle('rendererless', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('no built renderer bundle')
  })

  it('fails when the fonts are not packaged', () => {
    const files = goodFiles()
    delete files['/dist/assets/archivo-latin-400-normal.woff2']
    const result = verify(bundle('fontless', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('no bundled fonts')
  })

  it('fails when a required file is present but empty', () => {
    const files = goodFiles()
    files['/dist-electron/preload.cjs'] = ''
    const result = verify(bundle('hollow', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('/dist-electron/preload.cjs is empty')
  })

  it('fails when the source tree was swept into the package', () => {
    const files = goodFiles()
    files['/src/main/index.ts'] = 'export {}'
    const result = verify(bundle('leaky', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('ships files it should not')
  })
})
