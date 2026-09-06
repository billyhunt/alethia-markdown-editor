import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-versions-userdata')
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { grantRoot } = await import('../../src/main/paths.ts')
const { clearVersions, listVersions, readVersion, snapshotVersion } = await import(
  '../../src/main/versions.ts'
)

let root: string
const at = (name: string) => path.join(root, name)

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-ver-'))
  grantRoot(root)
  await fs.mkdir(USER_DATA, { recursive: true })
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(path.join(USER_DATA, 'versions'), { recursive: true, force: true })
})

const HOUR = 3_600_000

/** Ages a file's snapshots so the thinning rules can be exercised. */
async function backdate(filePath: string, byMs: number) {
  const dir = path.join(
    USER_DATA,
    'versions',
    (await import('node:crypto')).createHash('sha1').update(path.resolve(filePath)).digest('hex'),
  )
  for (const name of await fs.readdir(dir)) {
    const match = /^(\d+)-([0-9a-f]{8})\.snapshot$/.exec(name)
    if (!match) continue
    await fs.rename(
      path.join(dir, name),
      path.join(dir, `${Number(match[1]) - byMs}-${match[2]}.snapshot`),
    )
  }
}

describe('snapshotVersion', () => {
  it('records a version and lists it back', async () => {
    const file = at('a.md')
    await fs.writeFile(file, '# one')
    await snapshotVersion(file, '# one')

    const versions = await listVersions(file)
    expect(versions).toHaveLength(1)
    expect(await readVersion(file, versions[0].id)).toBe('# one')
  })

  it('skips a repeat of the newest snapshot, so a no-op save adds nothing', async () => {
    const file = at('dupe.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'same')
    await snapshotVersion(file, 'same')
    expect(await listVersions(file)).toHaveLength(1)
  })

  it('records back-to-back saves, however close together', async () => {
    // A small edit and its reversal must both leave a trace: throttling here
    // is what made the feature look broken.
    const file = at('rapid.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'v1')
    await snapshotVersion(file, 'v2')
    await snapshotVersion(file, 'v3')

    const versions = await listVersions(file)
    expect(versions).toHaveLength(3)
    // Newest first.
    expect(await readVersion(file, versions[0].id)).toBe('v3')
    expect(await readVersion(file, versions[2].id)).toBe('v1')
  })

  it('re-records content that reappears after something else', async () => {
    // Type a character, save, delete it, save: the original comes back, and
    // that is a distinct point in the history.
    const file = at('reversal.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'original')
    await snapshotVersion(file, 'original!')
    expect(await listVersions(file)).toHaveLength(2)
  })

  it('ignores empty content, which would only ever be a mistake to restore', async () => {
    const file = at('empty.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, '')
    expect(await listVersions(file)).toHaveLength(0)
  })

  it('keeps histories of different files apart', async () => {
    const one = at('one.md')
    const two = at('two.md')
    await fs.writeFile(one, 'x')
    await fs.writeFile(two, 'y')
    await snapshotVersion(one, 'content one')
    await snapshotVersion(two, 'content two')

    expect(await readVersion(one, (await listVersions(one))[0].id)).toBe('content one')
    expect(await readVersion(two, (await listVersions(two))[0].id)).toBe('content two')
  })
})

describe('thinning', () => {
  it('keeps everything from the last hour', async () => {
    const file = at('recent.md')
    await fs.writeFile(file, 'x')
    for (const body of ['a', 'b', 'c', 'd']) await snapshotVersion(file, body)
    expect(await listVersions(file)).toHaveLength(4)
  })

  it('keeps one per hour once versions are older than an hour', async () => {
    const file = at('hourly.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'a')
    await snapshotVersion(file, 'b')
    await snapshotVersion(file, 'c')
    expect(await listVersions(file)).toHaveLength(3)

    // Age them all into the same past hour, then add one more to trigger the
    // prune: the three collapse to the newest of that hour.
    await backdate(file, 3 * HOUR)
    await snapshotVersion(file, 'd')

    const versions = await listVersions(file)
    expect(versions).toHaveLength(2)
    expect(await readVersion(file, versions[0].id)).toBe('d')
  })
})

describe('readVersion', () => {
  it.each([
    ['a traversal', '../../../../etc/passwd'],
    ['a nested path', 'sub/dir.snapshot'],
    ['an arbitrary filename', 'origin.json'],
    ['a plausible but malformed id', '123-zzzzzzzz.snapshot'],
    ['a non-string', 42],
  ])('refuses %s as a version id', async (_label, id) => {
    const file = at('a.md')
    await expect(readVersion(file, id)).rejects.toThrow()
  })

  it('refuses to read versions of an ungranted file', async () => {
    await expect(readVersion('/etc/hosts', 'x')).rejects.toThrow(/EPERM/)
  })
})

describe('clearVersions', () => {
  it('removes the whole history for one file', async () => {
    const file = at('clear.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'gone')
    expect(await listVersions(file)).toHaveLength(1)

    await clearVersions(file)
    expect(await listVersions(file)).toHaveLength(0)
  })
})

describe('storage location', () => {
  it('writes nothing beside the document', async () => {
    const file = at('tidy.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'content')
    // The user's folder must stay free of sidecar files.
    expect(await fs.readdir(root)).not.toContain('.alethia')
    expect((await fs.readdir(root)).filter((n) => n.includes('snapshot'))).toHaveLength(0)
  })
})
