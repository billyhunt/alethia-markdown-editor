import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { assertReadable } from './paths.ts'
import type { DocumentVersion } from '../shared/api.ts'

/**
 * A local history of every state a file has been in.
 *
 * Snapshots live under userData rather than beside the document. Writing
 * them into the user's folder would put noise in their git repository or
 * their notes vault, and the whole point is that this is invisible until
 * wanted.
 *
 * What is stored is the content being REPLACED, not the content being
 * written: the live file is already the newest state, so the useful thing to
 * keep is whatever a save is about to overwrite.
 */

/** Beyond this, the oldest snapshots for a file are discarded. */
const MAX_VERSIONS_PER_FILE = 200

/**
 * Autosave fires every couple of seconds, and every keystroke changes the
 * content, so dedupe alone would not stop a snapshot per save. Successive
 * snapshots of the same file are spaced out instead.
 */
const MIN_INTERVAL_MS = 45_000

const VERSION_FILE = /^(\d+)-([0-9a-f]{8})\.snapshot$/

const versionsRoot = (): string => path.join(app.getPath('userData'), 'versions')

/** A stable directory per document, without putting its path in a filename. */
const keyFor = (filePath: string): string =>
  crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex')

const hashOf = (content: string): string =>
  crypto.createHash('sha1').update(content).digest('hex').slice(0, 8)

const dirFor = (filePath: string): string => path.join(versionsRoot(), keyFor(filePath))

async function entriesFor(filePath: string): Promise<DocumentVersion[]> {
  const dir = dirFor(filePath)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }

  const versions: DocumentVersion[] = []
  for (const name of names) {
    const match = VERSION_FILE.exec(name)
    if (!match) continue
    let size = 0
    try {
      size = (await fs.stat(path.join(dir, name))).size
    } catch {
      continue
    }
    versions.push({ id: name, savedAt: Number(match[1]), hash: match[2], bytes: size })
  }
  // Newest first, which is the order the history panel wants.
  return versions.sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Records `content` as a past state of `filePath`.
 *
 * Skips when the newest snapshot already holds this content, and when the
 * newest is too recent -- except for the very first, so a file always gets an
 * initial snapshot the moment it is first written through the app.
 */
export async function snapshotVersion(filePath: string, content: string): Promise<void> {
  if (content.length === 0) return

  const dir = dirFor(filePath)
  const existing = await entriesFor(filePath)
  const hash = hashOf(content)
  const newest = existing[0]

  if (newest) {
    if (newest.hash === hash) return
    if (Date.now() - newest.savedAt < MIN_INTERVAL_MS) return
  }

  await fs.mkdir(dir, { recursive: true })
  // Keeps the originating path discoverable for maintenance and cleanup,
  // since the directory name is only a hash.
  await fs
    .writeFile(path.join(dir, 'origin.json'), JSON.stringify({ path: filePath }, null, 2), {
      flag: 'w',
    })
    .catch(() => undefined)
  await fs.writeFile(path.join(dir, `${Date.now()}-${hash}.snapshot`), content, 'utf8')

  const all = await entriesFor(filePath)
  for (const stale of all.slice(MAX_VERSIONS_PER_FILE)) {
    await fs.rm(path.join(dir, stale.id), { force: true }).catch(() => undefined)
  }
}

export async function listVersions(input: unknown): Promise<DocumentVersion[]> {
  const filePath = await assertReadable(input)
  return entriesFor(filePath)
}

export async function readVersion(input: unknown, id: unknown): Promise<string> {
  const filePath = await assertReadable(input)
  if (typeof id !== 'string' || !VERSION_FILE.test(id)) {
    // The id becomes a filename, so it is matched against the exact shape
    // rather than merely checked for separators.
    throw new Error('EINVAL: not a version id')
  }
  return fs.readFile(path.join(dirFor(filePath), id), 'utf8')
}

export async function clearVersions(input: unknown): Promise<void> {
  const filePath = await assertReadable(input)
  await fs.rm(dirFor(filePath), { recursive: true, force: true })
}
