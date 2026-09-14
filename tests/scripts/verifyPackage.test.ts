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
function verify(app: string): { code: number; output: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, app], { encoding: 'utf8', stdio: 'pipe' })
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
  it('passes', () => {
    const result = verify(bundle('good'))
    expect(result.output).toContain('looks shippable')
    expect(result.code).toBe(0)
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

  it('fails when the bundle identity is wrong', () => {
    const wrong = PLIST.replace('com.billyhunt.alethia', 'com.example.someoneelse')
    const result = verify(bundle('misidentified', { plist: wrong }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('CFBundleIdentifier')
  })

  it('fails when the markdown claim is narrowed, not just absent', () => {
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

  it('fails when the source tree was swept into the package', () => {
    const files = goodFiles()
    files['/src/main/index.ts'] = 'export {}'
    const result = verify(bundle('leaky', { files }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('ships files it should not')
  })
})
