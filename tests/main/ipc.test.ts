// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
  showMessageBox: vi.fn(),
  route: vi.fn(),
  raise: vi.fn(),
  showing: null as unknown,
  sourcePath: '',
  dropToken: 'drop-token-1',
  showItemInFolder: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'alethia-ipc-userdata'), addRecentDocument: vi.fn(), clearRecentDocuments: vi.fn(), getVersion: () => 'test' },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => native.handlers.set(name, handler) },
  BrowserWindow: { fromWebContents: (sender: any) => native.windows.find(w => w.webContents === sender), getAllWindows: () => native.windows },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: vi.fn() },
  dialog: { showMessageBox: native.showMessageBox },
  shell: { showItemInFolder: native.showItemInFolder },
}))
vi.mock('../../src/main/watcher.ts', () => ({
  watchDocument: vi.fn(), watchFolder: vi.fn(), unwatchDocument: vi.fn(), unwatchFolder: vi.fn(),
}))
vi.mock('../../src/main/openWith.ts', () => ({ route: native.route }))
vi.mock('../../src/main/windows.ts', () => ({
  documentForId: (_win: unknown, id: unknown) => id === 'document-1' ? native.sourcePath : null,
  dropTokenMatches: (_contents: unknown, token: unknown) => token === native.dropToken,
  issueDropToken: () => 'preload-token',
  markForceClose: vi.fn(),
  noteDocument: vi.fn(),
  noteFolder: vi.fn(),
  setQuitting: vi.fn(),
  takeSession: vi.fn(() => ({ bounds: { width: 800, height: 600 }, folder: null, file: null })),
  windowShowing: vi.fn(() => native.showing),
  raise: native.raise,
}))
import { registerIpcHandlers } from '../../src/main/ipc.ts'
import { assertReadable, assertReadableDir, grantFile, grantRoot } from '../../src/main/paths.ts'
import { getSettings, patchSettings } from '../../src/main/settings.ts'
import { IPC } from '../../src/shared/ipc.ts'

let root: string
let secret: string
const invoke = (channel: string, ...args: unknown[]) =>
  Promise.resolve().then(() => native.handlers.get(channel)!({ sender: native.windows[0].webContents }, ...args))

beforeEach(async () => {
  // Canonical, as main reports paths: the macOS temp dir is a symlink.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-ipc-')))
  secret = path.join(root, 'secret.md')
  await fs.writeFile(secret, '# secret')
  native.sourcePath = path.join(root, 'source.md')
  await fs.writeFile(native.sourcePath, '# source')
  native.route.mockClear()
  native.raise.mockClear()
  native.showing = null
  native.windows = [{ id: 101, webContents: { id: 101, send: vi.fn() }, isDestroyed: () => false, isFullScreen: () => false, getNormalBounds: () => ({ width: 800, height: 600 }) }]
  native.showMessageBox.mockResolvedValue({ response: 1 })
  patchSettings({ recentFiles: [], recentFolders: [], windows: [] })
  registerIpcHandlers()
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

it('opens a linked file through IPC, confirms its real symlink target, and grants only that file', async () => {
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-linked-target-')))
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
    expect(native.route).toHaveBeenCalledWith({ path: canonicalTarget, kind: 'file' })
    await expect(assertReadable(canonicalTarget)).resolves.toBe(canonicalTarget)
    // The sibling in the same directory is NOT readable: the folder was never granted.
    const sibling = path.join(outside, 'sibling.md')
    await fs.writeFile(sibling, '# sibling')
    await expect(assertReadable(sibling)).rejects.toThrow(/EPERM/)
    await expect(assertReadableDir(path.dirname(canonicalTarget))).rejects.toThrow(/EPERM/)
  } finally {
    await fs.rm(outside, { recursive: true, force: true })
  }
})

it('does not widen an already file-granted linked target to its folder', async () => {
  const other = path.join(root, 'other.md')
  const neighbour = path.join(root, 'neighbour.md')
  await fs.writeFile(other, '# other')
  await fs.writeFile(neighbour, '# neighbour')
  grantFile(await fs.realpath(other))
  await invoke(IPC.appOpenLinkedFile, './other.md', 'document-1')
  expect(native.showMessageBox).not.toHaveBeenCalled()
  expect(native.route).toHaveBeenCalledWith({ path: await fs.realpath(other), kind: 'file' })
  await expect(assertReadable(neighbour)).rejects.toThrow(/EPERM/)
  expect(getSettings().windows).toEqual([])
})

it('raises the window already showing a linked file instead of opening another', async () => {
  const other = path.join(root, 'other.md')
  await fs.writeFile(other, '# other')
  native.showing = { id: 202 }
  await invoke(IPC.appOpenLinkedFile, './other.md', 'document-1')
  expect(native.raise).toHaveBeenCalledWith(native.showing)
  expect(native.route).not.toHaveBeenCalled()
  expect(native.showMessageBox).not.toHaveBeenCalled()
})

it('refuses a symlink whose real target is not markdown', async () => {
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-linked-target-')))
  const realTarget = path.join(outside, 'id_rsa')
  const linkDir = path.join(root, 'notes')
  await fs.writeFile(realTarget, 'private key')
  await fs.mkdir(linkDir)
  await fs.symlink(realTarget, path.join(linkDir, 'harmless.md'))
  try {
    await expect(invoke(IPC.appOpenLinkedFile, './notes/harmless.md', 'document-1')).rejects.toThrow(/not markdown/)
    expect(native.showMessageBox).not.toHaveBeenCalled()
    expect(native.route).not.toHaveBeenCalled()
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
it.each(['recentFiles', 'recentFolders', 'windows', 'windowBounds', 'theme'])('rejects renderer settings authority through %s', async key => {
  const patches: Record<string, unknown> = {
    recentFiles: { recentFiles: [secret] },
    // Every persisted recent folder is granted as a root on the next launch.
    recentFolders: { recentFolders: ['/'] },
    windows: { windows: [{ file: secret, folder: root }] },
    windowBounds: { windowBounds: { width: 1e9, height: -5 } },
    theme: { theme: 'dark' },
  }
  const before = structuredClone(getSettings())
  await expect(invoke(IPC.settingsPatch, patches[key])).rejects.toThrow(/EPERM/)
  expect(getSettings()).toEqual(before)
})
it('accepts the UI settings the renderer owns and clamps the sidebar width', async () => {
  await invoke(IPC.settingsPatch, { sidebar: { visible: false, width: 1e9 }, toolbarVisible: false, autosave: false })
  expect(getSettings()).toMatchObject({ sidebar: { visible: false, width: 800 }, toolbarVisible: false, autosave: false })
  await invoke(IPC.settingsPatch, { sidebar: { visible: true, width: 300 }, toolbarVisible: true, autosave: true })
  expect(getSettings()).toMatchObject({ sidebar: { visible: true, width: 300 }, toolbarVisible: true, autosave: true })
})
it.each([
  { toolbarVisible: 'yes' },
  { autosave: 1 },
  { sidebar: 'wide' },
  { sidebar: { visible: 'yes' } },
  { sidebar: { width: Infinity } },
  { sidebar: { width: '300' } },
  { sidebar: { width: null } },
])('rejects junk UI setting values %j', async patch => {
  const before = structuredClone(getSettings())
  await expect(invoke(IPC.settingsPatch, patch)).rejects.toThrow()
  expect(getSettings()).toEqual(before)
})
it('ignores unknown keys nested in the sidebar patch', async () => {
  await invoke(IPC.settingsPatch, { sidebar: { visible: true, width: 260, evil: '/etc' } })
  expect(getSettings().sidebar).toEqual({ visible: true, width: 260 })
})
it('accepts a drop only with the preload-issued token', async () => {
  await expect(invoke(IPC.appGrantDroppedPath, secret, 'wrong-token')).rejects.toThrow(/EPERM/)
  await expect(invoke(IPC.appGrantDroppedPath, secret, undefined)).rejects.toThrow(/EPERM/)
  await expect(assertReadable(secret)).rejects.toThrow(/EPERM/)
  await expect(invoke(IPC.appGrantDroppedPath, secret, native.dropToken)).resolves.toEqual({ path: secret, kind: 'file' })
  await expect(assertReadable(secret)).resolves.toBe(secret)
})
it('only reveals granted paths in Finder', async () => {
  await expect(invoke(IPC.shellShowItemInFolder, secret)).rejects.toThrow(/EPERM/)
  expect(native.showItemInFolder).not.toHaveBeenCalled()
  grantFile(secret)
  await invoke(IPC.shellShowItemInFolder, secret)
  expect(native.showItemInFolder).toHaveBeenCalledWith(secret)
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

it('refuses to record a folder that was never granted, so a recent cannot widen access', async () => {
  await expect(invoke(IPC.recentsAddFolder, '/')).rejects.toThrow(/EPERM/)
  await expect(invoke(IPC.recentsAddFolder, root)).rejects.toThrow(/EPERM/)
  expect(getSettings().recentFolders).toEqual([])
  await expect(assertReadableDir(root)).rejects.toThrow(/EPERM/)
})
it('records a folder main has already granted', async () => {
  grantRoot(root)
  await invoke(IPC.recentsAddFolder, root)
  expect(getSettings().recentFolders).toEqual([root])
})
it('moves a recent along with a renamed file, matching it by canonical path', async () => {
  // The renderer may name the file through a symlink; recents hold real paths.
  const link = path.join(os.tmpdir(), `alethia-ipc-link-${path.basename(root)}`)
  await fs.symlink(root, link)
  try {
    grantRoot(root)
    const draft = path.join(root, 'Draft.md')
    await fs.writeFile(draft, '# Draft')
    patchSettings({ recentFiles: [draft, secret] })

    const result = await invoke(IPC.fsRename, path.join(link, 'Draft.md'), 'Final')
    expect(result.path).toBe(path.join(root, 'Final.md'))
    expect(getSettings().recentFiles).toEqual([path.join(root, 'Final.md'), secret])
  } finally {
    await fs.rm(link, { force: true })
  }
})
