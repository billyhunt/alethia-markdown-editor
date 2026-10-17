import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => storage.root } }))
const { grantFile, assertReadable } = await import('../../src/main/paths.ts')
const { getKnown, readTextFile, renameFile, writeTextFile } = await import('../../src/main/files.ts')
const { snapshotVersion, listVersions, readVersion } = await import('../../src/main/versions.ts')
let root: string
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-persistence-'))
  storage.root = path.join(root, 'userData')
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })
async function file(name: string) {
  const target = path.join(root, name)
  await fs.writeFile(target, 'original')
  grantFile(target)
  return target
}

it('keeps each reader baseline after another window accepts an external edit', async () => {
  const target = await file('windows.md')
  const first = await readTextFile(target)
  await fs.writeFile(target, 'external')
  await fs.utimes(target, new Date(), new Date(Date.now() + 2000))
  await readTextFile(target)
  const result = await writeTextFile(target, 'stale edit', {
    expectedMtimeMs: first.mtimeMs, expectedText: first.content,
  })
  expect(result.ok).toBe(false)
  expect(await fs.readFile(target, 'utf8')).toBe('external')
})

it('serializes concurrent writes to a path before checking their shared baseline', async () => {
  const target = await file('serialized.md')
  const accepted = await readTextFile(target)
  const originalWrite = fs.writeFile.bind(fs)
  let beginWrite!: () => void
  let finishWrite!: () => void
  const writing = new Promise<void>(resolve => { beginWrite = resolve })
  const gate = new Promise<void>(resolve => { finishWrite = resolve })
  vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
    if (args[0] === target) {
      beginWrite()
      await gate
    }
    return originalWrite(...args)
  })
  const opts = { expectedMtimeMs: accepted.mtimeMs, expectedText: accepted.content }
  const first = writeTextFile(target, 'first save', opts)
  await writing
  const second = writeTextFile(target, 'second save', opts)
  finishWrite()
  const [one, two] = await Promise.all([first, second])
  expect(one.ok).toBe(true)
  expect(two).toMatchObject({ ok: false, reason: 'conflict' })
  expect(await fs.readFile(target, 'utf8')).toBe('first save')
})

it('serializes rename behind an in-flight save so the saved content follows the document', async () => {
  const from = await file('rename-save.md')
  const accepted = await readTextFile(from)
  const originalWrite = fs.writeFile.bind(fs)
  let beginWrite!: () => void
  let finishWrite!: () => void
  const writing = new Promise<void>(resolve => { beginWrite = resolve })
  const gate = new Promise<void>(resolve => { finishWrite = resolve })
  vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
    if (args[0] === from && args[1] === 'saved while renaming') {
      beginWrite()
      await gate
    }
    return originalWrite(...args)
  })
  const save = writeTextFile(from, 'saved while renaming', {
    expectedMtimeMs: accepted.mtimeMs, expectedText: accepted.content,
  })
  await writing
  const rename = renameFile(from, 'rename-save-final.md')
  finishWrite()
  const [saved, renamed] = await Promise.all([save, rename])
  expect(saved.ok).toBe(true)
  expect(await fs.readFile(renamed.path, 'utf8')).toBe('saved while renaming')
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a hidden bare extension before moving the source', async () => {
  const from = await file('hidden-destination-source.md')
  await expect(renameFile(from, '.md')).rejects.toThrow(/non-markdown/)
  expect(await fs.readFile(from, 'utf8')).toBe('original')
  await expect(fs.stat(path.join(root, '.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses changed content even if mtime is restored', async () => {
  const target = await file('mtime.md')
  const first = await readTextFile(target)
  await fs.writeFile(target, 'external')
  await fs.utimes(target, new Date(first.mtimeMs), new Date(first.mtimeMs))
  expect((await writeTextFile(target, 'stale', {
    expectedMtimeMs: first.mtimeMs, expectedText: first.content,
  })).ok).toBe(false)
  expect(await fs.readFile(target, 'utf8')).toBe('external')
})

it('does not replace a destination created at the move boundary', async () => {
  const from = await file('race.md')
  const to = path.join(root, 'race-next.md')
  const originalLink = fs.link.bind(fs)
  vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
    if (source === from) await fs.writeFile(to, 'racing file')
    return originalLink(source, destination)
  })
  await expect(renameFile(from, 'race-next.md')).rejects.toThrow(/EEXIST/)
  expect(await fs.readFile(to, 'utf8')).toBe('racing file')
  expect(await fs.readFile(from, 'utf8')).toBe('original')
  await expect(assertReadable(to)).rejects.toThrow(/EPERM/)
})

it('does not grant the destination after a failed move', async () => {
  const from = await file('failure.md')
  const to = path.join(root, 'failure-next.md')
  vi.spyOn(fs, 'link').mockRejectedValue(new Error('move failed'))
  await expect(renameFile(from, 'failure-next.md')).rejects.toThrow('move failed')
  await expect(assertReadable(to)).rejects.toThrow(/EPERM/)
  expect(await fs.readFile(from, 'utf8')).toBe('original')
})

it('uses an exclusive copy when the filesystem does not support hard links', async () => {
  const from = await file('external-drive.md')
  const originalLink = fs.link.bind(fs)
  vi.spyOn(fs, 'link').mockImplementation(async (...args) => {
    if (args[0] === from) throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' })
    return originalLink(...args)
  })
  const result = await renameFile(from, 'external-drive-renamed.md')
  expect(await fs.readFile(result.path, 'utf8')).toBe('original')
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('renames a case-only alias through a temporary path', async () => {
  const from = await file('Foo.md')
  const to = path.join(root, 'foo.md')
  const originalAccess = fs.access.bind(fs)
  const originalStat = fs.stat.bind(fs)
  const sourceStat = await originalStat(from)
  vi.spyOn(fs, 'access').mockImplementation(async target => {
    if (target === to) return
    return originalAccess(target)
  })
  vi.spyOn(fs, 'stat').mockImplementation(async target => {
    if (target === to) return sourceStat
    return originalStat(target)
  })
  const result = await renameFile(from, 'foo.md')
  expect(result.path).toBe(to)
  expect(await fs.readFile(to, 'utf8')).toBe('original')
  expect(await fs.readdir(root)).toContain('foo.md')
  expect(await fs.readdir(root)).not.toContain('Foo.md')
})

it('reports the temporary path if a case-only rename and its rollback both fail', async () => {
  const from = await file('Foo-double-failure.md')
  const to = path.join(root, 'foo-double-failure.md')
  const originalAccess = fs.access.bind(fs)
  const originalStat = fs.stat.bind(fs)
  const sourceStat = await originalStat(from)
  vi.spyOn(fs, 'access').mockImplementation(async target => {
    if (target === to) return
    return originalAccess(target)
  })
  vi.spyOn(fs, 'stat').mockImplementation(async target => {
    if (target === to) return sourceStat
    return originalStat(target)
  })
  const originalLink = fs.link.bind(fs)
  vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
    if (String(source).includes('.alethia-rename-') && (destination === to || destination === from)) {
      throw Object.assign(new Error('simulated move failure'), { code: 'EIO' })
    }
    return originalLink(source, destination)
  })
  let message = ''
  try {
    await renameFile(from, 'foo-double-failure.md')
  } catch (error) {
    message = (error as Error).message
  }
  const temporary = message.match(/remains at (.+)$/)?.[1]
  expect(temporary).toBeTruthy()
  expect(message).toContain(temporary)
  expect(await fs.readFile(temporary!, 'utf8')).toBe('original')
})

it('moves history and remembered content with the document', async () => {
  const from = await file('history.md')
  await readTextFile(from)
  const known = getKnown(from)
  await snapshotVersion(from, 'past content')
  const to = (await renameFile(from, 'history-next.md')).path
  expect(await fs.readFile(to, 'utf8')).toBe('original')
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(getKnown(to)).toEqual(known)
  expect(getKnown(from)).toBeUndefined()
  const versions = await listVersions(to)
  expect(versions).toHaveLength(1)
  expect(await readVersion(to, versions[0].id)).toBe('past content')
})

it('merges destination history and keeps colliding snapshots during rename', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  try {
    const from = await file('history-source.md')
    const to = path.join(root, 'history-target.md')
    await snapshotVersion(from, 'same snapshot')
    await snapshotVersion(to, 'same snapshot')
    const historyDir = path.join(
      storage.root,
      'versions',
      crypto.createHash('sha1').update(path.resolve(to)).digest('hex'),
    )
    const snapshotHash = crypto.createHash('sha1').update('same snapshot').digest('hex').slice(0, 8)
    await fs.writeFile(path.join(historyDir, `${Date.now() + 1}-${snapshotHash}.snapshot`), 'occupied')
    expect((await renameFile(from, 'history-target.md')).path).toBe(to)
    const versions = await listVersions(to)
    expect(versions).toHaveLength(3)
    expect(versions.map(version => version.id)).toContain(`${Date.now() + 2}-${snapshotHash}.snapshot`)
    expect(await Promise.all(versions.map(version => readVersion(to, version.id))))
      .toContain('same snapshot')
  } finally {
    vi.useRealTimers()
  }
})
