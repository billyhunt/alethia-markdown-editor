import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => storage.root } }))
const { grantFile } = await import('../../src/main/paths.ts')
const { renameFile, writeTextFile } = await import('../../src/main/files.ts')
let root: string
beforeAll(async () => {
  // Resolved up front so path checks need no extra I/O of their own.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-rename-stale-')))
  storage.root = path.join(root, 'userData')
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

it('saves to a name that was renamed away and later reused', async () => {
  const from = path.join(root, 'reused.md')
  await fs.writeFile(from, 'first document')
  grantFile(from)
  const renamed = await renameFile(from, 'reused-renamed.md')

  // Save As back to the old name, or an external tool recreating it.
  expect((await writeTextFile(from, 'second document')).ok).toBe(true)
  expect(await fs.readFile(from, 'utf8')).toBe('second document')
  await fs.writeFile(from, 'created by git checkout')
  expect((await writeTextFile(from, 'third document')).ok).toBe(true)
  expect(await fs.readFile(from, 'utf8')).toBe('third document')
  expect(await fs.readFile(renamed.path, 'utf8')).toBe('first document')
})

it('refuses a save that waited for a rename of its path', async () => {
  const from = path.join(root, 'queued.md')
  await fs.writeFile(from, 'document')
  grantFile(from)

  // Hold the rename open inside its lock so the save has to queue behind it.
  const originalLink = fs.link.bind(fs)
  const linking = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
    if (source === from) {
      linking.resolve()
      await gate.promise
    }
    return originalLink(source, destination)
  })
  const rename = renameFile(from, 'queued-renamed.md')
  await linking.promise

  // The save's only I/O before it queues is resolving its path; once that
  // returns, nothing but microtasks stand between it and the lock.
  const originalRealpath = fs.realpath.bind(fs)
  const resolving = Promise.withResolvers<void>()
  vi.spyOn(fs, 'realpath').mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
    const result = await originalRealpath(...args)
    if (args[0] === from) resolving.resolve()
    return result
  })
  const save = writeTextFile(from, 'content meant for the old name')
  const refused = expect(save).rejects.toThrow(/ESTALE/)
  await resolving.promise
  await nextTurn()

  gate.resolve()
  const renamed = await rename
  await refused
  await expect(fs.stat(from)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(renamed.path, 'utf8')).toBe('document')
})
