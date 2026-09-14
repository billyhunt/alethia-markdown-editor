#!/usr/bin/env node
/**
 * Checks that a packaged .app is actually shippable.
 *
 * `electron-builder` exits 0 in cases that still produce a broken bundle: a
 * renderer that never built, a preload that landed as ESM and so cannot load,
 * an `asar` missing the font licences the OFL requires to travel with every
 * copy, or a `files` glob that quietly swept in the whole source tree. Unit
 * tests cannot see any of that, so this runs against the build output itself.
 *
 * What it does NOT do: launch the app, exercise preload/IPC for real, check
 * Finder behaviour, build Intel or the DMG, or say anything about signing and
 * notarization. A pass here means the bundle is structurally sound, not that
 * it is releasable.
 *
 * Usage: node scripts/verify-package.mjs [path/to/Alethia.app]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * electron-builder names its output directory after the architecture:
 * `release/mac-arm64`, `release/mac` on Intel, `release/mac-universal` for a
 * universal build. Hardcoding one of those makes this fail on a perfectly
 * good bundle built elsewhere, so the directory is discovered.
 */
function defaultApp() {
  try {
    for (const entry of fs.readdirSync('release')) {
      if (!entry.startsWith('mac')) continue
      const candidate = path.join('release', entry, 'Alethia.app')
      if (fs.existsSync(candidate)) return candidate
    }
  } catch {
    // No release directory at all; fall through to the conventional path so
    // the error names something recognisable.
  }
  return 'release/mac-arm64/Alethia.app'
}

const app = process.argv[2] ?? defaultApp()
const failures = []
const fail = (message) => failures.push(message)

/**
 * Reads an asar's index without unpacking it and without the `asar` package.
 *
 * The archive opens with four little-endian uint32s. The fourth is the size
 * of a JSON index listing every entry with its size and its offset into the
 * data section that follows the index.
 */
function readAsar(archive) {
  const bytes = fs.statSync(archive).size
  const fd = fs.openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(16)
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('shorter than an asar header')

    // The first field is the size of the second; the third and fourth
    // describe the index. Checking them catches a file that merely happens to
    // start with plausible bytes.
    if (prefix.readUInt32LE(0) !== 4) throw new Error('not an asar: bad pickle prefix')
    const indexSize = prefix.readUInt32LE(12)
    if (indexSize < 2 || indexSize > 64 * 1024 * 1024) {
      throw new Error(`implausible index size ${indexSize}`)
    }
    if (prefix.readUInt32LE(8) < indexSize) throw new Error('not an asar: inconsistent lengths')

    const json = Buffer.alloc(indexSize)
    if (fs.readSync(fd, json, 0, indexSize, 16) !== indexSize) {
      throw new Error('index is truncated')
    }
    const index = JSON.parse(json.toString('utf8').replace(/\0+$/, ''))

    // Entry offsets are relative to the end of the index, padded to a
    // 4-byte boundary.
    const dataStart = 16 + Math.ceil(indexSize / 4) * 4
    const entries = new Map()
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const at = `${prefix}/${name}`
        if (entry.files) walk(entry, at)
        else entries.set(at, entry)
      }
    }
    walk(index, '')

    /**
     * Reads one packaged file, which proves its bytes are really present.
     * Opens its own descriptor, because this outlives the one above.
     */
    const read = (entryPath) => {
      const entry = entries.get(entryPath)
      if (!entry || entry.unpacked) return null
      const size = entry.size ?? 0
      const buffer = Buffer.alloc(size)
      if (size === 0) return buffer

      const handle = fs.openSync(archive, 'r')
      try {
        const at = dataStart + Number(entry.offset)
        return fs.readSync(handle, buffer, 0, size, at) === size ? buffer : null
      } finally {
        fs.closeSync(handle)
      }
    }

    // A truncated archive still carries a complete index, so every required
    // path would be found while the bytes behind them are gone.
    let end = dataStart
    for (const [at, entry] of entries) {
      if (entry.unpacked) continue
      const stop = dataStart + Number(entry.offset ?? 0) + (entry.size ?? 0)
      if (stop > bytes) throw new Error(`${at} runs past the end of the archive`)
      if (stop > end) end = stop
    }

    return { paths: [...entries.keys()], read, bytes, end }
  } finally {
    fs.closeSync(fd)
  }
}

const plistValue = (plist, key, format = 'raw') => {
  try {
    return execFileSync('plutil', ['-extract', key, format, '-o', '-', plist], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

/**
 * `plutil` ships with macOS and nowhere else. Without it the bundle identity
 * cannot be read at all, which is reported once and plainly rather than as
 * three separate "missing key" failures that look like a bad build.
 */
const havePlutil = (() => {
  try {
    execFileSync('plutil', ['-help'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// ---- the bundle itself ----

if (!fs.existsSync(app) || !fs.statSync(app).isDirectory()) {
  console.error(`No app bundle at ${app}`)
  process.exit(1)
}

const executable = path.join(app, 'Contents/MacOS/Alethia')
try {
  fs.accessSync(executable, fs.constants.X_OK)
} catch {
  fail(`no executable at ${executable}`)
}

const plist = path.join(app, 'Contents/Info.plist')
if (!fs.existsSync(plist)) {
  fail('no Info.plist')
} else if (!havePlutil) {
  fail(
    'plutil is unavailable, so the bundle identity and document types cannot be ' +
      'verified; run this on macOS',
  )
} else {
  for (const [key, value] of Object.entries({
    CFBundleName: 'Alethia',
    CFBundleIdentifier: 'com.billyhunt.alethia',
  })) {
    const actual = plistValue(plist, key)
    if (actual !== value) fail(`Info.plist ${key} is ${actual ?? 'missing'}, expected ${value}`)
  }

  // The app claims markdown in electron-builder.yml. A build that drops or
  // narrows the declaration stops appearing in Finder's Open With list, so
  // check the extensions themselves rather than merely that some declaration
  // exists.
  const raw = plistValue(plist, 'CFBundleDocumentTypes', 'json')
  if (raw === null) {
    fail('Info.plist declares no CFBundleDocumentTypes')
  } else {
    let declared = []
    try {
      declared = JSON.parse(raw).flatMap((type) => type.CFBundleTypeExtensions ?? [])
    } catch {
      fail('Info.plist CFBundleDocumentTypes is not readable as JSON')
    }
    for (const extension of ['md', 'markdown', 'mdown', 'mkd']) {
      if (!declared.includes(extension)) {
        fail(`Info.plist does not claim .${extension} (declared: ${declared.join(', ') || 'none'})`)
      }
    }
  }
}

// ---- what shipped inside the asar ----

const archive = path.join(app, 'Contents/Resources/app.asar')
if (!fs.existsSync(archive)) {
  fail('no app.asar (an unpacked or failed build)')
} else {
  let asar = null
  try {
    asar = readAsar(archive)
  } catch (error) {
    fail(`app.asar is unreadable: ${error.message}`)
  }

  if (asar) {
    const required = [
      '/dist/index.html',
      '/dist-electron/main.js',
      // Loaded by name in src/main/windows.ts. Without it the renderer has no
      // API bridge at all, and the app opens to a dead window.
      '/dist-electron/preload.cjs',
      '/package.json',
      // OFL requires the licence to travel with every redistributed copy,
      // including inside the .app.
      '/LICENSE',
      '/THIRD_PARTY_NOTICES.md',
      '/licenses/OFL-archivo.txt',
      '/licenses/OFL-archivo-black.txt',
      '/licenses/OFL-dm-mono.txt',
    ]
    for (const entry of required) {
      if (!asar.paths.includes(entry)) {
        fail(`app.asar is missing ${entry}`)
        continue
      }
      // A zero-length entry is present and useless: an index.html or a
      // preload truncated to nothing would otherwise pass.
      const contents = asar.read(entry)
      if (contents === null) fail(`${entry} has no readable content`)
      else if (contents.length === 0) fail(`${entry} is empty`)
    }

    // The renderer and the fonts arrive as hashed assets, so they cannot be
    // named. Without these the licence checks above would certify OFL
    // compliance for fonts that are not in the bundle.
    if (!asar.paths.some((entry) => /^\/dist\/assets\/.*\.js$/.test(entry))) {
      fail('app.asar has no built renderer bundle under /dist/assets')
    }
    if (!asar.paths.some((entry) => /^\/dist\/assets\/.*\.woff2?$/.test(entry))) {
      fail('app.asar has no bundled fonts under /dist/assets')
    }

    // An index.html that survived packaging says nothing about the renderer
    // bundle it points at, and a missing asset is a blank window.
    const html = asar.read('/dist/index.html')
    if (html === null) {
      if (asar.paths.includes('/dist/index.html')) fail('/dist/index.html has no readable content')
    } else {
      const referenced = [...html.toString('utf8').matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((href) => !/^[a-z]+:|^\/\//i.test(href))
      if (referenced.length === 0) fail('/dist/index.html references no local assets')
      for (const href of referenced) {
        const at = `/dist/${path.normalize(href).replace(/^\/+/, '')}`
        if (!asar.paths.includes(at)) fail(`/dist/index.html references ${href}, which is not packaged`)
      }
    }

    // A `files` glob that widens by accident ships the source tree and the
    // dev dependencies, which is both a size and a disclosure problem.
    const forbidden = asar.paths.filter(
      (entry) =>
        entry.startsWith('/src/') ||
        entry.startsWith('/tests/') ||
        /^\/node_modules\/(vitest|electron|electron-builder|typescript|oxlint)\//.test(entry),
    )
    if (forbidden.length > 0) {
      fail(`app.asar ships files it should not: ${forbidden.slice(0, 5).join(', ')}`)
    }

    if (failures.length === 0) {
      console.log(
        `app.asar: ${asar.paths.length} entries, ${asar.end} of ${asar.bytes} bytes accounted for`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${app} is not shippable:`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`${app} looks shippable`)
