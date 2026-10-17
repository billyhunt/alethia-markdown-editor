import crypto from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertReadable, assertReadableDir, assertWritable, assertWritableSibling, grantFile } from './paths.ts'
import { moveVersionHistory, snapshotVersion } from './versions.ts'
import { MARKDOWN_EXTENSIONS } from '../shared/markdown.ts'
import type {
  LineEnding,
  ReadFileResult,
  StatResult,
  WriteFileResult,
  WriteFileOptions,
  RenameFileResult,
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

/** Serializes writes to one path so each conflict check sees the prior write. */
const writeTails = new Map<string, Promise<void>>()

async function withWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(filePath) ?? Promise.resolve()
  let release!: () => void
  const turn = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => turn)
  writeTails.set(filePath, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (writeTails.get(filePath) === tail) writeTails.delete(filePath)
  }
}

async function withWriteLocks<T>(filePaths: string[], operation: () => Promise<T>): Promise<T> {
  const [first, second] = [...new Set(filePaths)].sort()
  return withWriteLock(first, () => second ? withWriteLock(second, operation) : operation())
}

/** Paths moved by rename reject stale writes that were queued before it. */
const renamedPaths = new Map<string, string>()

const hash = (content: string): string =>
  crypto.createHash('sha1').update(content).digest('hex')

export const getKnown = (filePath: string): KnownState | undefined => known.get(filePath)

export const isSuppressed = (filePath: string): boolean =>
  Date.now() < (suppressUntil.get(filePath) ?? 0)

export function rememberState(filePath: string, content: string, mtimeMs: number): void {
  known.set(filePath, { mtimeMs, size: Buffer.byteLength(content, 'utf8'), hash: hash(content) })
}

async function findConflict(
  filePath: string,
  opts: WriteFileOptions,
): Promise<WriteFileResult | null> {
  if (opts.force || (opts.expectedMtimeMs == null && opts.expectedText == null)) return null
  try {
    const disk = await fs.stat(filePath)
    const drifted = opts.expectedMtimeMs == null || Math.abs(disk.mtimeMs - opts.expectedMtimeMs) > 1
    if (opts.expectedText != null) {
      const onDisk = await fs.readFile(filePath, 'utf8')
      const withoutBom = onDisk.charCodeAt(0) === 0xfeff ? onDisk.slice(1) : onDisk
      if (toLf(withoutBom) !== opts.expectedText) {
        return { ok: false, reason: 'conflict', diskMtimeMs: disk.mtimeMs }
      }
    } else if (drifted) {
      const onDisk = await fs.readFile(filePath, 'utf8')
      if (hash(onDisk) !== known.get(filePath)?.hash) {
        return { ok: false, reason: 'conflict', diskMtimeMs: disk.mtimeMs }
      }
    }
    return null
  } catch (error) {
    // A missing file is not a conflict -- saving recreates it.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
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

  return withWriteLock(filePath, async () => {
    const movedTo = renamedPaths.get(filePath)
    if (movedTo) throw new Error(`ESTALE: file was renamed to ${movedTo}`)
    const conflict = await findConflict(filePath, opts)
    if (conflict) return conflict

    // Keep whatever this save is about to replace, so nothing is ever lost to
    // an autosave. Failure here must not stop the save itself.
    await fs
      .readFile(filePath, 'utf8')
      .then((previous) => snapshotVersion(filePath, previous))
      .catch(() => undefined)

    // Version snapshots can take time. Recheck after that await so an external
    // edit made while history is being recorded is not overwritten.
    const changedDuringSnapshot = await findConflict(filePath, opts)
    if (changedDuringSnapshot) return changedDuringSnapshot

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
  })
}

const HARD_LINK_UNAVAILABLE = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'])

/** Exclusive copy is the no-hard-link fallback used by removable filesystems. */
async function copyNoReplace(from: string, to: string): Promise<void> {
  await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(to, 'r+')
    await handle.sync()
  } catch (error) {
    await fs.unlink(to).catch(() => undefined)
    throw error
  } finally {
    await handle?.close()
  }
  try {
    await fs.unlink(from)
  } catch (error) {
    await fs.unlink(to).catch(() => undefined)
    throw error
  }
}

/** Moves a file without replacing a destination, including on exFAT. */
async function moveNoReplace(from: string, to: string): Promise<void> {
  try {
    await fs.link(from, to)
  } catch (error) {
    if (!HARD_LINK_UNAVAILABLE.has((error as NodeJS.ErrnoException).code ?? '')) throw error
    await copyNoReplace(from, to)
    return
  }
  try {
    await fs.unlink(from)
  } catch (error) {
    await fs.unlink(to).catch(() => undefined)
    throw error
  }
}

/**
 * Renames within the same directory only. `name` is a basename, so a value
 * containing separators or `..` cannot walk out of the folder, and the result
 * still has to pass the write rules (markdown extension, granted path).
 */
export async function renameFile(input: unknown, name: unknown): Promise<RenameFileResult> {
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
  if (to === from) return { path: from }

  return withWriteLocks([from, to], async () => {
  await assertWritableSibling(from, to)

  let caseOnly = false
  try {
    await fs.access(to)
    const [source, destination] = await Promise.all([fs.stat(from), fs.stat(to)])
    caseOnly = source.dev === destination.dev && source.ino === destination.ino
    if (!caseOnly) throw new Error(`EEXIST: "${withExt}" already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  if (caseOnly) {
    const temporary = path.join(path.dirname(from), `.alethia-rename-${crypto.randomUUID()}.tmp`)
    await moveNoReplace(from, temporary)
    try {
      await moveNoReplace(temporary, to)
    } catch (error) {
      await moveNoReplace(temporary, from).catch((rollbackError) => {
        throw new Error(`Rename failed and the file could not be restored; it remains at ${temporary}`, {
          cause: new AggregateError([error, rollbackError]),
        })
      })
      throw error
    }
  } else {
    // Exclusive link/copy never replaces a destination created after access().
    await moveNoReplace(from, to)
  }
  grantFile(to)
  renamedPaths.set(from, to)
  renamedPaths.delete(to)
  const state = known.get(from)
  if (state) {
    known.delete(from)
    known.set(to, state)
  }
  const suppressed = suppressUntil.get(from)
  suppressUntil.delete(from)
  if (suppressed !== undefined) suppressUntil.set(to, suppressed)
  let historyPath: string | undefined
  try {
    await moveVersionHistory(from, to)
  } catch (error) {
    console.error(`Could not move version history for ${to}`, error)
    historyPath = from
  }
  return { path: to, ...(historyPath ? { historyPath } : {}) }
  })
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
