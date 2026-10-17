// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
  showMessageBox: vi.fn(),
  createWindow: vi.fn(),
  sourcePath: '',
}))
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), addRecentDocument: vi.fn(), getVersion: () => 'test' },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => native.handlers.set(name, handler) },
  BrowserWindow: { fromWebContents: (sender: any) => native.windows.find(w => w.webContents === sender), getAllWindows: () => native.windows },
  dialog: { showMessageBox: native.showMessageBox },
  shell: {},
}))
vi.mock('../../src/main/watcher.ts', () => ({
  watchDocument: vi.fn(), watchFolder: vi.fn(), unwatchDocument: vi.fn(), unwatchFolder: vi.fn(),
}))
vi.mock('../../src/main/windows.ts', () => ({
  createWindow: native.createWindow,
  documentForId: (_win: unknown, id: unknown) => id === 'document-1' ? native.sourcePath : null,
  dropTokenMatches: () => false,
  issueDropToken: () => 'preload-token',
  markForceClose: vi.fn(),
  noteDocument: vi.fn(),
  noteFolder: vi.fn(),
  setQuitting: vi.fn(),
  takeSession: vi.fn(() => ({ bounds: { width: 800, height: 600 }, folder: null, file: null })),
  windowShowing: vi.fn(() => null),
}))
import { registerIpcHandlers } from '../../src/main/ipc.ts'
import { assertReadable, assertReadableDir, grantFile } from '../../src/main/paths.ts'
import { getSettings, patchSettings } from '../../src/main/settings.ts'
import { IPC } from '../../src/shared/ipc.ts'

let root: string
let secret: string
const invoke = (channel: string, ...args: unknown[]) =>
  Promise.resolve().then(() => native.handlers.get(channel)!({ sender: native.windows[0].webContents }, ...args))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-ipc-'))
  secret = path.join(root, 'secret.md')
  await fs.writeFile(secret, '# secret')
  native.sourcePath = path.join(root, 'source.md')
  await fs.writeFile(native.sourcePath, '# source')
  native.createWindow.mockClear()
  native.windows = [{ id: 101, webContents: { id: 101 }, isDestroyed: () => false, isFullScreen: () => false, getNormalBounds: () => ({ width: 800, height: 600 }) }]
  native.showMessageBox.mockResolvedValue({ response: 1 })
  patchSettings({ recentFiles: [], windows: [] })
  registerIpcHandlers()
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

it('opens a linked file through IPC, confirms its real symlink target, and grants its folder', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-linked-target-'))
  const realTarget = path.join(outside, 'real.md')
  const linkDir = path.join(root, 'notes')
  const linkPath = path.join(linkDir, 'secret.md')
  await fs.writeFile(realTarget, '# private')
  const canonicalTarget = await fs.realpath(realTarget)
  await fs.mkdir(linkDir)
  await fs.symlink(realTarget, linkPath)
  native.showMessageBox.mockResolvedValue({ response: 0 })
  try {
    await invoke(IPC.appOpenLinkedFile, './notes/secret.md', 'document-1')
    expect(native.showMessageBox.mock.calls[0][1]).toMatchObject({
      message: expect.stringContaining('symbolic link'),
      detail: canonicalTarget,
    })
    expect(native.createWindow).toHaveBeenCalledWith(expect.objectContaining({ folder: path.dirname(canonicalTarget), file: canonicalTarget }))
    await expect(assertReadable(canonicalTarget)).resolves.toBe(canonicalTarget)
    await expect(assertReadableDir(path.dirname(canonicalTarget))).resolves.toBe(path.dirname(canonicalTarget))
  } finally {
    await fs.rm(outside, { recursive: true, force: true })
  }
})

it('refuses a symlink whose real target is not markdown', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-linked-target-'))
  const realTarget = path.join(outside, 'id_rsa')
  const linkDir = path.join(root, 'notes')
  await fs.writeFile(realTarget, 'private key')
  await fs.mkdir(linkDir)
  await fs.symlink(realTarget, path.join(linkDir, 'harmless.md'))
  try {
    await expect(invoke(IPC.appOpenLinkedFile, './notes/harmless.md', 'document-1')).rejects.toThrow(/not markdown/)
    expect(native.showMessageBox).not.toHaveBeenCalled()
    expect(native.createWindow).not.toHaveBeenCalled()
  } finally {
    await fs.rm(outside, { recursive: true, force: true })
  }
})

it('refuses an arbitrary dropped path without preload authentication', async () => {
  await expect(invoke(IPC.appGrantDroppedPath, secret)).rejects.toThrow(/EPERM/)
  await expect(assertReadable(secret)).rejects.toThrow(/EPERM/)
})
it('refuses to turn an ungranted recent into a grant', async () => {
  await expect(invoke(IPC.recentsAdd, secret)).rejects.toThrow(/EPERM/)
  expect(getSettings().recentFiles).toEqual([])
  await expect(assertReadable(secret)).rejects.toThrow(/EPERM/)
})
it.each(['recentFiles', 'windows'])('rejects renderer settings authority through %s', async key => {
  const patch = key === 'recentFiles' ? { recentFiles: [secret] } : { windows: [{ file: secret, folder: root }] }
  await expect(invoke(IPC.settingsPatch, patch)).rejects.toThrow(/EPERM/)
  expect(getSettings().recentFiles).toEqual([])
  expect(getSettings().windows).toEqual([])
})
it.each([IPC.folderList, IPC.folderWatch, IPC.docWatch])('refuses ungranted folder or watch paths through %s', async channel => {
  await expect(invoke(channel, channel === IPC.folderWatch ? root : secret)).rejects.toThrow(/EPERM/)
  expect(getSettings().windows).toEqual([])
})
it('still records a granted recent', async () => {
  grantFile(secret)
  await invoke(IPC.recentsAdd, secret)
  expect(getSettings().recentFiles).toEqual([secret])
})
