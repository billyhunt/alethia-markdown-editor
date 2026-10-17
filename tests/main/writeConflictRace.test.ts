import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({
  root: '',
  snapshotStarted: (() => {}) as () => void,
  finishSnapshot: (() => {}) as () => void,
}))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
vi.mock('../../src/main/versions.ts', () => ({
  snapshotVersion: () => new Promise<void>(resolve => {
    state.snapshotStarted()
    state.finishSnapshot = resolve
  }),
  moveVersionHistory: vi.fn(),
}))
const { grantFile } = await import('../../src/main/paths.ts')
const { readTextFile, writeTextFile } = await import('../../src/main/files.ts')
let root: string
beforeAll(async () => {
  // Real path: main resolves document paths, and macOS's tmpdir is a symlink.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-conflict-race-')))
  state.root = path.join(root, 'userData')
})
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

it('rechecks disk after waiting for the version snapshot', async () => {
  const target = path.join(root, 'during-snapshot.md')
  await fs.writeFile(target, 'accepted')
  grantFile(target)
  const accepted = await readTextFile(target)
  let snapshotStarted!: () => void
  const started = new Promise<void>(resolve => { snapshotStarted = resolve })
  state.snapshotStarted = snapshotStarted

  const saving = writeTextFile(target, 'stale buffer', {
    expectedMtimeMs: accepted.mtimeMs,
    expectedText: accepted.content,
  })
  await started
  await fs.writeFile(target, 'external edit')
  state.finishSnapshot()

  const result = await saving
  expect(result.ok).toBe(false)
  expect(await fs.readFile(target, 'utf8')).toBe('external edit')
})
