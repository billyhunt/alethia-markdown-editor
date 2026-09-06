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

/** Snapshots are throttled, so tests that need several rewind the clock. */
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

  it('skips a snapshot whose content matches the newest', async () => {
    const file = at('dupe.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'same')
    await backdate(file, 60_000)
    await snapshotVersion(file, 'same')
    expect(await listVersions(file)).toHaveLength(1)
  })

  it('throttles successive snapshots so autosave cannot flood the history', async () => {
    const file = at('throttle.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'v1')
    // Different content, but immediately after the first.
    await snapshotVersion(file, 'v2')
    expect(await listVersions(file)).toHaveLength(1)
  })

  it('records again once the interval has passed', async () => {
    const file = at('spaced.md')
    await fs.writeFile(file, 'x')
    await snapshotVersion(file, 'v1')
    await backdate(file, 60_000)
    await snapshotVersion(file, 'v2')

    const versions = await listVersions(file)
    expect(versions).toHaveLength(2)
    // Newest first.
    expect(await readVersion(file, versions[0].id)).toBe('v2')
    expect(await readVersion(file, versions[1].id)).toBe('v1')
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
