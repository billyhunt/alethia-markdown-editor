import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  assertReadable,
  assertReadableDir,
  assertWritable,
  assertWritableNewFile,
  grantFile,
  grantRoot,
} from './paths.ts'
import { moveVersions, snapshotVersion } from './versions.ts'
import { MARKDOWN_EXTENSIONS } from '../shared/markdown.ts'
import type {
  CreateFileOptions,
  CreateFileResult,
  LineEnding,
  ReadFileResult,
  StatResult,
  WriteFileResult,
  WriteFileOptions,
} from '../shared/api.ts'

/**
 * Which ending a file predominantly uses. CodeMirror works in LF only, so a
 * CRLF file would otherwise be silently rewritten on the first save -- a
 * whole-file diff for anyone on Windows or in a mixed repository.
 */
function detectLineEnding(raw: string): LineEnding {
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? '\r\n' : '\n'
}

const toLf = (text: string): string => text.replace(/\r\n/g, '\n')
const fromLf = (text: string, ending: LineEnding): string =>
  ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text

interface KnownState {
  mtimeMs: number
  size: number
  hash: string
}

/**
 * The last state we ourselves read or wrote for a path. The watcher consults
 * this to tell our own saves apart from genuine external edits.
 */
const known = new Map<string, KnownState>()

/** Paths whose watcher events should be ignored until this timestamp. */
const suppressUntil = new Map<string, number>()

const hash = (content: string): string =>
  crypto.createHash('sha1').update(content).digest('hex')

export const getKnown = (filePath: string): KnownState | undefined => known.get(filePath)

export const isSuppressed = (filePath: string): boolean =>
  Date.now() < (suppressUntil.get(filePath) ?? 0)

export function rememberState(filePath: string, content: string, mtimeMs: number): void {
  known.set(filePath, { mtimeMs, size: Buffer.byteLength(content, 'utf8'), hash: hash(content) })
}

/**
 * A renamed file is the same file. Without moving its bookkeeping across, the
 * next save compares the new path against no known state at all and reports a
 * conflict for a document nobody else touched.
 */
function followRename(from: string, to: string): void {
  const state = known.get(from)
  if (state) {
    known.set(to, state)
    known.delete(from)
  }
  const until = suppressUntil.get(from)
  if (until !== undefined) {
    suppressUntil.set(to, until)
    suppressUntil.delete(from)
  }
}

export async function readTextFile(input: unknown): Promise<ReadFileResult> {
  const filePath = await assertReadable(input)
  const raw = await fs.readFile(filePath, 'utf8')
  // Strip a UTF-8 BOM; it would otherwise show up as a stray glyph.
  const onDisk = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const stats = await fs.stat(filePath)
  // The watcher compares against what is actually on disk, so hash that
  // rather than the LF-normalised copy handed to the editor.
  rememberState(filePath, onDisk, stats.mtimeMs)
  return {
    path: filePath,
    content: toLf(onDisk),
    lineEnding: detectLineEnding(onDisk),
    mtimeMs: stats.mtimeMs,
  }
}

export async function writeTextFile(
  input: unknown,
  content: unknown,
  opts: WriteFileOptions = {},
): Promise<WriteFileResult> {
  const filePath = await assertWritable(input)
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string')
  }

  if (opts.expectedMtimeMs != null && !opts.force) {
    try {
      const disk = await fs.stat(filePath)
      const drifted = Math.abs(disk.mtimeMs - opts.expectedMtimeMs) > 1
      // An mtime bump with identical content (a touch, or a metadata-only
      // write) is not a real conflict.
      if (drifted) {
        const onDisk = await fs.readFile(filePath, 'utf8')
        if (hash(onDisk) !== known.get(filePath)?.hash) {
          return { ok: false, reason: 'conflict', diskMtimeMs: disk.mtimeMs }
        }
      }
    } catch (error) {
      // A missing file is not a conflict -- saving recreates it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  // Keep whatever this save is about to replace, so nothing is ever lost to
  // an autosave. Failure here must not stop the save itself.
  await fs
    .readFile(filePath, 'utf8')
    .then((previous) => snapshotVersion(filePath, previous))
    .catch(() => undefined)

  // Restore whatever endings the file arrived with.
  const onDisk = fromLf(content, opts.lineEnding ?? '\n')

  // Written in place rather than temp-and-rename: rename would replace
  // symlinks, drop Finder tags and xattrs, and change the inode, which
  // confuses other editors watching the same file.
  await fs.writeFile(filePath, onDisk, 'utf8')
  const stats = await fs.stat(filePath)
  rememberState(filePath, onDisk, stats.mtimeMs)
  suppressUntil.set(filePath, Date.now() + 500)
  return { ok: true, mtimeMs: stats.mtimeMs }
}

/**
 * Renames within the same directory only. `name` is a basename, so a value
 * containing separators or `..` cannot walk out of the folder, and the result
 * still has to pass the write rules (markdown extension, granted path).
 */
export async function renameFile(input: unknown, name: unknown): Promise<string> {
  const from = await assertWritable(input)
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('name must be a non-empty string')
  }
  const base = path.basename(name.trim())
  if (base !== name.trim() || base === '.' || base === '..') {
    throw new Error('EINVAL: name must be a file name, not a path')
  }
  const withExt = MARKDOWN_EXTENSIONS.some((ext) => base.toLowerCase().endsWith(ext))
    ? base
    : `${base}.md`
  const to = path.join(path.dirname(from), withExt)
  if (to === from) return from

  // Checked without following a symlink and before any grant: granting a
  // destination that turns out to be a link would hand out access to whatever
  // it points at.
  try {
    await fs.lstat(to)
    throw new Error(`EEXIST: "${withExt}" already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  // Grant the destination before the move so the caller can read it back.
  grantFile(to)
  await assertWritable(to)

  // link-then-unlink rather than rename: rename replaces its destination
  // silently, so two windows whose documents reach the same title at the same
  // moment could each pass the check above and the loser's file would be
  // gone. link fails with EEXIST instead, atomically.
  try {
    await fs.link(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`EEXIST: "${withExt}" already exists`)
    }
    // Hard links do not cross devices and are refused on a few filesystems;
    // fall back to a plain rename, which is still same-directory only.
    await fs.rename(from, to)
    followRename(from, to)
    await moveVersions(from, to)
    return to
  }
  await fs.unlink(from)
  followRename(from, to)
  // History is keyed by path, so it has to follow the document or editing a
  // title would quietly strand every earlier version.
  await moveVersions(from, to)
  return to
}

/** Where automatically named documents go when no folder is open. */
async function defaultDocumentsDir(): Promise<string> {
  const dir = path.join(app.getPath('documents'), 'Alethia')
  await fs.mkdir(dir, { recursive: true })
  // The app made this folder, so it is a source main controls.
  return grantRoot(dir)
}

const withMarkdownExtension = (base: string): string =>
  MARKDOWN_EXTENSIONS.some((ext) => base.toLowerCase().endsWith(ext)) ? base : `${base}.md`

/** "Notes.md" taken -> "Notes 2.md", the way the Finder numbers copies. */
function numbered(base: string, n: number): string {
  if (n === 1) return base
  const dot = base.lastIndexOf('.')
  return `${base.slice(0, dot)} ${n}${base.slice(dot)}`
}

/**
 * Creates a markdown file named `name`, holding `content`, inside `dir` (or
 * inside the default folder when none is given), without a dialog.
 *
 * Content is written at creation rather than left to a following save: a
 * two-step create-then-write would leave an empty file behind whenever the
 * write failed, and would number a fresh name on every retry.
 *
 * `name` is a basename, so it cannot walk out of the directory, and `dir` has
 * to be a directory the user already granted -- a folder they opened, or one
 * this app created for the purpose. An existing file is never overwritten:
 * the name is numbered until it is free, and creation is exclusive, so two
 * windows racing cannot land on the same path and an entry that appears in
 * between is never followed.
 */
export async function createNamedFile(input: unknown): Promise<CreateFileResult> {
  const opts = (typeof input === 'object' && input !== null ? input : {}) as CreateFileOptions
  if (typeof opts.name !== 'string' || opts.name.trim() === '') {
    throw new TypeError('name must be a non-empty string')
  }
  const trimmed = opts.name.trim()
  if (path.basename(trimmed) !== trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error('EINVAL: name must be a file name, not a path')
  }

  if (opts.content != null && typeof opts.content !== 'string') {
    throw new TypeError('content must be a string')
  }
  const dir = opts.dir == null ? await defaultDocumentsDir() : await assertReadableDir(opts.dir)
  const base = withMarkdownExtension(trimmed)
  const onDisk = fromLf(opts.content ?? '', opts.lineEnding ?? '\n')

  for (let n = 1; n <= 100; n += 1) {
    const target = path.join(dir, numbered(base, n))
    // Checked, not granted: see assertWritableNewFile. The grant is issued
    // only for a file this call actually created.
    await assertWritableNewFile(target)
    try {
      await fs.writeFile(target, onDisk, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      continue
    }
    grantFile(target)
    const stats = await fs.stat(target)
    rememberState(target, onDisk, stats.mtimeMs)
    suppressUntil.set(target, Date.now() + 500)
    return { path: target, mtimeMs: stats.mtimeMs }
  }
  throw new Error(`EEXIST: too many files named like "${base}"`)
}

export async function statPath(input: unknown): Promise<StatResult | null> {
  // stat is also used on directories (workspace roots), which are granted as
  // roots rather than as individual files.
  const target = await assertReadable(input).catch(() => assertReadableDir(input))
  try {
    const stats = await fs.stat(target)
    return {
      kind: stats.isDirectory() ? 'dir' : 'file',
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
