#!/usr/bin/env node
/**
 * Checks that a packaged .app is actually shippable.
 *
 * `electron-builder` exits 0 in cases that still produce a broken bundle: a
 * renderer that never built, an `asar` missing the font licences the OFL
 * requires to travel with every copy, or a `files` glob that quietly swept in
 * the whole source tree. Unit tests cannot see any of that, so this runs
 * against the build output itself.
 *
 * Usage: node scripts/verify-package.mjs [path/to/Alethia.app]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const app = process.argv[2] ?? 'release/mac-arm64/Alethia.app'
const failures = []
const fail = (message) => failures.push(message)

/**
 * Reads the paths an asar holds without unpacking it and without the `asar`
 * package: the archive opens with four little-endian uint32s, the fourth
 * being the size of a JSON header that lists every entry.
 */
function asarPaths(archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(16)
    if (fs.readSync(fd, prefix, 0, 16, 0) < 16) throw new Error('shorter than an asar header')

    const size = prefix.readUInt32LE(12)
    // A plausible header is kilobytes to a few megabytes; anything else means
    // this is not the file we think it is.
    if (size < 2 || size > 64 * 1024 * 1024) throw new Error(`implausible header size ${size}`)

    const json = Buffer.alloc(size)
    fs.readSync(fd, json, 0, size, 16)
    const header = JSON.parse(json.toString('utf8').replace(/\0+$/, ''))

    const paths = []
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const at = `${prefix}/${name}`
        if (entry.files) walk(entry, at)
        else paths.push(at)
      }
    }
    walk(header, '')
    return paths
  } finally {
    fs.closeSync(fd)
  }
}

const plistValue = (plist, key) => {
  try {
    return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

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
} else {
  const expected = {
    CFBundleName: 'Alethia',
    CFBundleIdentifier: 'com.billyhunt.alethia',
  }
  for (const [key, value] of Object.entries(expected)) {
    const actual = plistValue(plist, key)
    if (actual !== value) fail(`Info.plist ${key} is ${actual ?? 'missing'}, expected ${value}`)
  }

  // The app claims markdown in electron-builder.yml; a build that drops the
  // declaration stops appearing in Finder's Open With list.
  const types = plistValue(plist, 'CFBundleDocumentTypes')
  if (types === null) fail('Info.plist declares no CFBundleDocumentTypes')
}

// ---- what shipped inside the asar ----

const archive = path.join(app, 'Contents/Resources/app.asar')
if (!fs.existsSync(archive)) {
  fail('no app.asar (an unpacked or failed build)')
} else {
  let paths = []
  try {
    paths = asarPaths(archive)
  } catch (error) {
    fail(`app.asar is unreadable: ${error.message}`)
  }

  const required = [
    '/dist/index.html',
    '/dist-electron/main.js',
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
    if (!paths.includes(entry)) fail(`app.asar is missing ${entry}`)
  }

  // A `files` glob that widens by accident ships the source tree and the dev
  // dependencies, which is both a size and a disclosure problem.
  const forbidden = paths.filter(
    (entry) =>
      entry.startsWith('/src/') ||
      entry.startsWith('/tests/') ||
      /^\/node_modules\/(vitest|electron|electron-builder|typescript|oxlint)\//.test(entry),
  )
  if (forbidden.length > 0) {
    fail(`app.asar ships files it should not: ${forbidden.slice(0, 5).join(', ')}`)
  }

  console.log(`app.asar: ${paths.length} entries, licences and built renderer present`)
}

if (failures.length > 0) {
  console.error(`\n${app} is not shippable:`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`${app} looks shippable`)
