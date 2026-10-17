import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
vi.mock('../../src/main/versions.ts', () => ({
  snapshotVersion: vi.fn(),
  moveVersionHistory: vi.fn().mockRejectedValue(new Error('history storage unavailable')),
}))
const { grantFile } = await import('../../src/main/paths.ts')
const { renameFile } = await import('../../src/main/files.ts')
let root: string
beforeAll(async () => {
  // Real path: main resolves document paths, and macOS's tmpdir is a symlink.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-rename-history-')))
  state.root = path.join(root, 'userData')
})
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

it('returns the new file path and the old history key when migration fails', async () => {
  const from = path.join(root, 'before.md')
  await fs.writeFile(from, 'document')
  grantFile(from)
  const result = await renameFile(from, 'after.md')
  expect(result).toEqual({ path: path.join(root, 'after.md'), historyPath: from })
  expect(await fs.readFile(result.path, 'utf8')).toBe('document')
})
