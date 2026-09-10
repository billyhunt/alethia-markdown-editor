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

/** A hard ceiling, reached only after a very long editing session. */
const MAX_VERSIONS_PER_FILE = 500

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Recent history is kept in full and older history is thinned, rather than
 * spacing snapshots apart as they are taken.
 *
 * Throttling at write time looked tidier but was wrong: it meant a small edit
 * and its reversal left no trace, so the obvious way to check the feature --
 * change something, look at the history -- showed nothing.
 *
 * Everything from the last hour survives; the previous day keeps one version
 * per hour; older than that, one per day.
 */
function thin(versions: DocumentVersion[]): DocumentVersion[] {
  const now = Date.now()
  const seen = new Set<number>()
  const doomed: DocumentVersion[] = []

  for (const version of versions) {
    const age = now - version.savedAt
    if (age <= HOUR) continue

    const bucket = age <= DAY ? Math.floor(version.savedAt / HOUR) : Math.floor(version.savedAt / DAY)
    const scope = age <= DAY ? 'h' : 'd'
    const key = Number(`${scope === 'h' ? 1 : 2}${bucket}`)
    // Versions arrive newest first, so the first of a bucket is its keeper.
    if (seen.has(key)) doomed.push(version)
    else seen.add(key)
  }

  return doomed
}

const VERSION_FILE = /^(\d+)-([0-9a-f]{8})\.snapshot$/

const versionsRoot = (): string => path.join(app.getPath('userData'), 'versions')

/** A stable directory per document, without putting its path in a filename. */
const keyFor = (filePath: string): string =>
  crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex')

const hashOf = (content: string): string =>
  crypto.createHash('sha1').update(content).digest('hex').slice(0, 8)

const dirFor = (filePath: string): string => path.join(versionsRoot(), keyFor(filePath))

/**
 * The newest stamp handed out per file.
 *
 * Snapshots are named by millisecond, and two saves can land inside the same
 * one -- a manual save racing an autosave, say. That would leave their order
 * undefined, and if their content hashes also matched, the second would
 * overwrite the first. Stamps are therefore forced to increase.
 */
const lastStamp = new Map<string, number>()

function nextStamp(dir: string): number {
  const stamp = Math.max(Date.now(), (lastStamp.get(dir) ?? 0) + 1)
  lastStamp.set(dir, stamp)
  return stamp
}

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
 * The only thing skipped is a repeat of the newest snapshot, so a save that
 * changed nothing does not add an entry.
 */
export async function snapshotVersion(filePath: string, content: string): Promise<void> {
  if (content.length === 0) return

  const dir = dirFor(filePath)
  const existing = await entriesFor(filePath)
  const hash = hashOf(content)
  if (existing[0]?.hash === hash) return

  await fs.mkdir(dir, { recursive: true })
  // Keeps the originating path discoverable for maintenance and cleanup,
  // since the directory name is only a hash.
  await fs
    .writeFile(path.join(dir, 'origin.json'), JSON.stringify({ path: filePath }, null, 2), {
      flag: 'w',
    })
    .catch(() => undefined)
  await fs.writeFile(path.join(dir, `${nextStamp(dir)}-${hash}.snapshot`), content, 'utf8')

  const all = await entriesFor(filePath)
  const stale = [...thin(all), ...all.slice(MAX_VERSIONS_PER_FILE)]
  for (const version of stale) {
    await fs.rm(path.join(dir, version.id), { force: true }).catch(() => undefined)
  }
}

/**
 * Follows a renamed document, so its history is not stranded under the name
 * it used to have. Renaming is no longer only a deliberate act -- an
 * automatically named file follows its title -- and history that silently
 * detaches would undermine the whole reason autosaving is safe.
 *
 * A destination that already has history is left alone: that history belongs
 * to whatever used to live at this path, and merging the two would be worse
 * than leaving the old set where it is.
 */
export async function moveVersions(from: string, to: string): Promise<void> {
  const fromDir = dirFor(from)
  const toDir = dirFor(to)
  if (fromDir === toDir) return

  try {
    await fs.access(toDir)
    return
  } catch {
    /* nothing there yet, which is the case worth handling */
  }
  try {
    await fs.rename(fromDir, toDir)
  } catch {
    // No history to move, or it could not be moved; the live file is safe
    // either way and this must never fail a rename.
    return
  }
  await fs
    .writeFile(path.join(toDir, 'origin.json'), JSON.stringify({ path: to }, null, 2), { flag: 'w' })
    .catch(() => undefined)

  const stamp = lastStamp.get(fromDir)
  if (stamp !== undefined) {
    lastStamp.set(toDir, stamp)
    lastStamp.delete(fromDir)
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
