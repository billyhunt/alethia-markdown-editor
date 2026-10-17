// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ windows: [] as any[], id: 10 }))
vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: { getAllWindows: () => native.windows },
  nativeTheme: { shouldUseDarkColors: false },
  screen: {},
}))
vi.mock('../../src/main/security.ts', () => ({ hardenWebContents: vi.fn() }))
vi.mock('../../src/main/settings.ts', () => ({
  getSettings: () => ({ windowBounds: { width: 800, height: 600 } }),
  patchSettings: vi.fn(),
}))
vi.mock('../../src/main/watcher.ts', () => ({ closeWatchersFor: vi.fn() }))
import { documentForId, noteDocument } from '../../src/main/windows.ts'

let root: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-window-identity-')))
  const win = {
    id: native.id++,
    isDestroyed: () => false,
    isFullScreen: () => false,
    getNormalBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
  }
  native.windows = [win]
})

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

// Main only ever records canonical paths (docWatch resolves them first), so
// identity here is plain path equality.
it('keeps the document id when the same document is watched again, and changes it for another', async () => {
  const a = path.join(root, 'a.md')
  const b = path.join(root, 'b.md')
  await fs.writeFile(a, '# a')
  await fs.writeFile(b, '# b')
  const win = native.windows[0]
  const first = noteDocument(win, a)
  expect(first).toBeTruthy()
  expect(noteDocument(win, a)).toBe(first)
  expect(documentForId(win, first)).toBe(a)
  const second = noteDocument(win, b)
  expect(second).not.toBe(first)
  expect(documentForId(win, first)).toBeNull()
  expect(noteDocument(win, null)).toBeNull()
  expect(noteDocument(win, b)).not.toBe(second)
})
