import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => storage.root } }))
const { grantFile, assertReadable } = await import('../../src/main/paths.ts')
const { getKnown, readTextFile, renameFile, writeTextFile } = await import('../../src/main/files.ts')
const { snapshotVersion, listVersions, readVersion } = await import('../../src/main/versions.ts')
let root: string
beforeAll(async () => {
  // Real path: main resolves document paths, and macOS's tmpdir is a symlink.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-persistence-')))
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

const execFileAsync = promisify(execFile)

/** Simulates a volume (exFAT, SMB) where hard links cannot be created. */
function noHardLinks(from: string) {
  const originalLink = fs.link.bind(fs)
  vi.spyOn(fs, 'link').mockImplementation(async (...args) => {
    if (args[0] === from) throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' })
    return originalLink(...args)
  })
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

it('renames a case-only alias with one rename and no hidden intermediate name', async () => {
  const from = await file('Foo.md')
  const to = path.join(root, 'foo.md')
  const originalAccess = fs.access.bind(fs)
  const originalStat = fs.stat.bind(fs)
  const sourceStat = await originalStat(from)
  // Make this volume behave as case-insensitive, whatever it really is.
  vi.spyOn(fs, 'access').mockImplementation(async target => {
    if (target === to) return
    return originalAccess(target)
  })
  vi.spyOn(fs, 'stat').mockImplementation(async target => {
    if (target === to) return sourceStat
    return originalStat(target)
  })
  const link = vi.spyOn(fs, 'link')
  const rename = vi.spyOn(fs, 'rename')
  const result = await renameFile(from, 'foo.md')
  expect(result.path).toBe(to)
  expect(rename.mock.calls.filter(([source]) => source === from)).toEqual([[from, to]])
  expect(link).not.toHaveBeenCalled()
  expect(await fs.readFile(to, 'utf8')).toBe('original')
  const names = await fs.readdir(root)
  expect(names).toContain('foo.md')
  expect(names).not.toContain('Foo.md')
  expect(names.filter(name => name.includes('.alethia-rename-'))).toEqual([])
})

async function isCaseInsensitive(): Promise<boolean> {
  const probe = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-case-probe-'))
  try {
    await fs.writeFile(path.join(probe, 'Probe.md'), '')
    return await fs.access(path.join(probe, 'probe.md')).then(() => true, () => false)
  } finally {
    await fs.rm(probe, { recursive: true, force: true })
  }
}

it.skipIf(!(await isCaseInsensitive()))('changes the case of a name on a case-insensitive volume', async () => {
  const from = await file('Real-Case.md')
  const before = await fs.stat(from)
  const result = await renameFile(from, 'real-case.md')
  expect(result.path).toBe(path.join(root, 'real-case.md'))
  const names = await fs.readdir(root)
  expect(names).toContain('real-case.md')
  expect(names).not.toContain('Real-Case.md')
  const after = await fs.stat(result.path)
  expect(after.ino).toBe(before.ino)
  expect(await fs.readFile(result.path, 'utf8')).toBe('original')
})

it('does not mistake a hard-link pair for a case-only rename', async () => {
  const from = await file('pair-a.md')
  const other = path.join(root, 'pair-b.md')
  await fs.link(from, other)
  const link = vi.spyOn(fs, 'link')
  const rename = vi.spyOn(fs, 'rename')
  await expect(renameFile(from, 'pair-b.md')).rejects.toThrow(/EEXIST/)
  expect(link).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
  expect(await fs.readFile(from, 'utf8')).toBe('original')
  expect(await fs.readFile(other, 'utf8')).toBe('original')
})

it('refuses to rename a folder whose name ends in .md', async () => {
  const from = path.join(root, 'folder.md')
  await fs.mkdir(from)
  await fs.writeFile(path.join(from, 'inside.md'), 'kept')
  grantFile(from)
  // rename(2) would silently replace an empty folder at the destination, and
  // Node has no exclusive form of it; only files go through the no-replace move.
  await expect(renameFile(from, 'folder-next.md')).rejects.toThrow(/only files can be renamed/)
  expect(await fs.readFile(path.join(from, 'inside.md'), 'utf8')).toBe('kept')
  await expect(fs.stat(path.join(root, 'folder-next.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['hard link', 'exclusive copy'])('keeps the new name when the source disappears during a %s move', async (how) => {
  const slug = how.replace(' ', '-')
  const from = await file(`vanishing-${slug}.md`)
  if (how === 'exclusive copy') {
    noHardLinks(from)
    const originalCopy = fs.copyFile.bind(fs)
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => {
      await originalCopy(...args)
      await fs.unlink(from)
    })
    // Copying the source's metadata afterwards cannot succeed; that is logged.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  } else {
    const originalLink = fs.link.bind(fs)
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      await originalLink(source, destination)
      await fs.unlink(source)
    })
  }
  // The copy at the destination is now the only one; it must not be removed.
  const result = await renameFile(from, `vanishing-${slug}-next.md`)
  expect(await fs.readFile(result.path, 'utf8')).toBe('original')
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps modification time and permissions through the exclusive-copy fallback', async () => {
  const from = await file('metadata.md')
  await fs.chmod(from, 0o640)
  const stamp = new Date('2020-01-02T03:04:05.678Z')
  await fs.utimes(from, stamp, stamp)
  const before = await fs.stat(from)
  noHardLinks(from)
  const result = await renameFile(from, 'metadata-next.md')
  const after = await fs.stat(result.path)
  expect(after.mode & 0o7777).toBe(0o640)
  expect(Math.abs(after.mtimeMs - before.mtimeMs)).toBeLessThan(1)
  expect(await fs.readFile(result.path, 'utf8')).toBe('original')
})

it('renames a read-only file through the exclusive-copy fallback', async () => {
  const from = await file('read-only.md')
  await fs.chmod(from, 0o444)
  noHardLinks(from)
  const result = await renameFile(from, 'read-only-next.md')
  expect((await fs.stat(result.path)).mode & 0o7777).toBe(0o444)
  expect(await fs.readFile(result.path, 'utf8')).toBe('original')
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
})

it.skipIf(process.platform !== 'darwin').each([['0644', 0o644], ['0444', 0o444]])(
  'keeps extended attributes of a %s file through the exclusive-copy fallback',
  async (label, mode) => {
    const from = await file(`tagged-${label}.md`)
    const name = 'user.alethia-test'
    await execFileAsync('/usr/bin/xattr', ['-w', '-x', name, '00 ff 10 0a 62', from])
    await fs.chmod(from, mode)
    noHardLinks(from)
    const result = await renameFile(from, `tagged-${label}-next.md`)
    const { stdout } = await execFileAsync('/usr/bin/xattr', ['-p', '-x', name, result.path])
    expect(stdout.trim()).toBe('00 FF 10 0A 62')
    expect((await fs.stat(result.path)).mode & 0o7777).toBe(mode)
    expect(await fs.readFile(result.path, 'utf8')).toBe('original')
  },
)

it('still completes the rename when copied metadata cannot be restored', async () => {
  const from = await file('unrestorable.md')
  noHardLinks(from)
  const failure = Object.assign(new Error('not permitted on this volume'), { code: 'EPERM' })
  vi.spyOn(fs, 'chmod').mockRejectedValue(failure)
  vi.spyOn(fs, 'utimes').mockRejectedValue(failure)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const result = await renameFile(from, 'unrestorable-next.md')
  expect(await fs.readFile(result.path, 'utf8')).toBe('original')
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
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

it('reports history as moved when only its origin note cannot be rewritten', async () => {
  const from = await file('origin-note.md')
  await snapshotVersion(from, 'past content')
  const originalWrite = fs.writeFile.bind(fs)
  vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('origin.json')) {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    }
    return originalWrite(...args)
  })
  const result = await renameFile(from, 'origin-note-next.md')
  // The directory itself moved, so history belongs to the new path.
  expect(result).toEqual({ path: path.join(root, 'origin-note-next.md') })
  const versions = await listVersions(result.path)
  expect(versions).toHaveLength(1)
  expect(await readVersion(result.path, versions[0].id)).toBe('past content')
})

it('merges destination history and keeps colliding snapshots during rename', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  try {
    const from = await file('history-source.md')
    const to = path.join(root, 'history-target.md')
    grantFile(to) // snapshotVersion now requires a granted path
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
