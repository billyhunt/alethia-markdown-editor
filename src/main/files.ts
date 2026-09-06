import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertReadable, assertReadableDir, assertWritable, grantFile } from './paths.ts'
import { MARKDOWN_EXTENSIONS } from '../shared/markdown.ts'
import type { ReadFileResult, StatResult, WriteFileResult, WriteFileOptions } from '../shared/api.ts'

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

export async function readTextFile(input: unknown): Promise<ReadFileResult> {
  const filePath = await assertReadable(input)
  const raw = await fs.readFile(filePath, 'utf8')
  // Strip a UTF-8 BOM; it would otherwise show up as a stray glyph.
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const stats = await fs.stat(filePath)
  rememberState(filePath, content, stats.mtimeMs)
  return { path: filePath, content, mtimeMs: stats.mtimeMs }
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

  // Written in place rather than temp-and-rename: rename would replace
  // symlinks, drop Finder tags and xattrs, and change the inode, which
  // confuses other editors watching the same file.
  await fs.writeFile(filePath, content, 'utf8')
  const stats = await fs.stat(filePath)
  rememberState(filePath, content, stats.mtimeMs)
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

  // Never silently clobber an existing file.
  try {
    await fs.access(to)
    throw new Error(`EEXIST: "${withExt}" already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  // Grant the destination before the rename so the caller can read it back.
  grantFile(to)
  await assertWritable(to)
  await fs.rename(from, to)
  return to
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
