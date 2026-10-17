import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
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

/**
 * Serializes writes to one path so each conflict check sees the prior write.
 *
 * A lane exists only while something is queued on or holding the path, so
 * nothing accumulates for files that were written once and left alone.
 */
interface WriteLane {
  tail: Promise<void>
  /**
   * How many times the path has been renamed away while this lane has been
   * alive. A turn compares it with the value it saw when it joined the queue:
   * a change means its request was made for a document that no longer lives
   * here. Requests that join after the rename see the new value, so a later
   * file created at the old name saves normally.
   */
  renames: number
}

const writeLanes = new Map<string, WriteLane>()

/**
 * Runs `operation` once earlier writes to `filePath` have finished. It is told
 * whether the path was renamed away while it waited.
 */
async function withWriteLock<T>(
  filePath: string,
  operation: (renamedWhileQueued: boolean) => Promise<T>,
): Promise<T> {
  const lane = writeLanes.get(filePath) ?? { tail: Promise.resolve(), renames: 0 }
  const queuedAt = lane.renames
  const previous = lane.tail
  let release!: () => void
  const turn = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => turn)
  lane.tail = tail
  writeLanes.set(filePath, lane)
  await previous
  try {
    return await operation(lane.renames !== queuedAt)
  } finally {
    release()
    if (lane.tail === tail) writeLanes.delete(filePath)
  }
}

async function withWriteLocks<T>(filePaths: string[], operation: () => Promise<T>): Promise<T> {
  const [first, second] = [...new Set(filePaths)].sort()
  return withWriteLock(first, () => second ? withWriteLock(second, operation) : operation())
}

/** Called by the holder of `filePath`'s lock once the document has left it. */
function markRenamedAway(filePath: string): void {
  const lane = writeLanes.get(filePath)
  if (lane) lane.renames++
}

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

  return withWriteLock(filePath, async (renamedWhileQueued) => {
    // This save was made for a document that has since moved; writing now
    // would resurrect the old name with stale content.
    if (renamedWhileQueued) throw new Error(`ESTALE: ${path.basename(filePath)} was renamed before this save could run`)
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

const execFileAsync = promisify(execFile)

/**
 * Node's copyFile carries the content and the mode but not extended
 * attributes (Finder tags, the quarantine flag), and Node has no API for
 * them; the system tool does. A failure on one attribute does not stop the
 * others being copied.
 */
async function copyExtendedAttributes(from: string, to: string): Promise<void> {
  const { stdout } = await execFileAsync('/usr/bin/xattr', [from])
  let failure: unknown
  for (const name of stdout.split('\n')) {
    // The kernel stamps this one itself and ignores attempts to write it.
    if (name === '' || name === 'com.apple.provenance') continue
    try {
      const { stdout: value } = await execFileAsync('/usr/bin/xattr', ['-p', '-x', name, from])
      await execFileAsync('/usr/bin/xattr', ['-w', '-x', name, value.trim(), to])
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) throw failure
}

/**
 * Gives a copy what rename(2) would have kept. On macOS copyFile keeps the
 * mode and access time but not the modification time or extended attributes,
 * and a conflict check or a Finder tag depends on those.
 *
 * Best effort: the content is already safely at `to`, and the volumes that
 * need this fallback (exFAT, network shares) are exactly the ones that may
 * refuse some of these calls. Failing the rename would leave them unable to
 * rename at all.
 */
async function restoreMetadata(from: string, to: string, source: Stats): Promise<void> {
  const attempt = async (what: string, step: () => Promise<unknown>): Promise<void> => {
    try {
      await step()
    } catch (error) {
      console.error(`Could not restore ${what} on ${to}`, error)
    }
  }
  const mode = source.mode & 0o7777
  if (process.platform === 'darwin') {
    await attempt('extended attributes', async () => {
      // A copy of a read-only file would refuse to take its own attributes.
      await fs.chmod(to, mode | 0o200)
      await copyExtendedAttributes(from, to)
    })
  }
  await attempt('permissions', () => fs.chmod(to, mode))
  await attempt('timestamps', () => fs.utimes(to, source.atimeMs / 1000, source.mtimeMs / 1000))
}

/**
 * Completes a move by removing the source. If something else already did, the
 * copy at `to` may now be the only one and must stay.
 */
async function removeSource(from: string, to: string): Promise<void> {
  try {
    await fs.unlink(from)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    await fs.unlink(to).catch(() => undefined)
    throw error
  }
}

/** Exclusive copy is the no-hard-link fallback used by removable filesystems. */
async function copyNoReplace(from: string, to: string): Promise<void> {
  const source = await fs.stat(from)
  await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL)
  let handle: FileHandle | undefined
  try {
    // Read-only: a copy of a read-only file is read-only too, and fsync does
    // not need write access.
    handle = await fs.open(to, 'r')
    await handle.sync()
  } catch (error) {
    await fs.unlink(to).catch(() => undefined)
    throw error
  } finally {
    await handle?.close()
  }
  await restoreMetadata(from, to, source)
  await removeSource(from, to)
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
  await removeSource(from, to)
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

    const source = await fs.stat(from)
    if (source.isDirectory()) {
      // The no-replace move is built on link(2), which refuses folders, and
      // rename(2) would silently replace an empty folder at the destination.
      // The sidebar only offers Rename on files, so refuse rather than risk it.
      throw new Error(`EISDIR: "${path.basename(from)}" is a folder; only files can be renamed`)
    }

    // The destination being this very file under a name that differs only in
    // case (or Unicode normalization) is how a case-insensitive volume shows a
    // case-only rename, not a collision. The names must match too: two hard
    // links to one file (a.md, b.md) share an inode but are a real collision.
    const [oldName, newName] = [path.basename(from), withExt].map(
      (entry) => entry.normalize('NFC').toLowerCase(),
    )
    let caseOnly = false
    try {
      await fs.access(to)
      const destination = await fs.stat(to)
      caseOnly =
        oldName === newName && source.dev === destination.dev && source.ino === destination.ino
      if (!caseOnly) throw new Error(`EEXIST: "${withExt}" already exists`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    if (caseOnly) {
      // Same file, so rename(2) only changes its stored name, atomically; the
      // file is never without a name and there is nothing to roll back.
      await fs.rename(from, to)
    } else {
      // Exclusive link/copy never replaces a destination created after access().
      await moveNoReplace(from, to)
    }
    grantFile(to)
    markRenamedAway(from)
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
