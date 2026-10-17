import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-recentfolders-userdata')
const sent = vi.hoisted(() => [] as Array<[string, unknown]>)
const windows = vi.hoisted(() => [
  { webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) } },
])
vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, addRecentDocument: vi.fn(), clearRecentDocuments: vi.fn() },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template), setApplicationMenu: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => windows,
  },
  shell: { openExternal: vi.fn() },
  nativeTheme: {},
  screen: {},
}))

const { addRecentFolder, clearRecentFolders, listRecentFolders, grantPersistedRecents } =
  await import('../../src/main/recents.ts')
const { getSettings, loadSettings, patchSettings } = await import('../../src/main/settings.ts')
const { buildApplicationMenu } = await import('../../src/main/menu.ts')
const { Menu } = await import('electron')
const { assertReadableDir, grantRoot } = await import('../../src/main/paths.ts')

let vaultA: string
let vaultB: string

beforeAll(async () => {
  // Canonical, as main reports and stores them: the macOS temp dir is a symlink.
  vaultA = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-a-')))
  vaultB = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-b-')))
  await fs.mkdir(USER_DATA, { recursive: true })
  // Recording a folder no longer grants it, so these stand in for folders
  // the user opened through the directory dialog.
  grantRoot(vaultA)
  grantRoot(vaultB)
})

afterAll(async () => {
  await fs.rm(vaultA, { recursive: true, force: true })
  await fs.rm(vaultB, { recursive: true, force: true })
  await fs.rm(USER_DATA, { recursive: true, force: true })
})

beforeEach(() => {
  patchSettings({ recentFolders: [] })
  sent.length = 0
})

describe('recent workspace folders', () => {
  it('keeps the most recently opened folder first, without duplicates', async () => {
    await addRecentFolder(vaultA)
    await addRecentFolder(vaultB)
    await addRecentFolder(vaultA)
    expect(await listRecentFolders()).toEqual([vaultA, vaultB])
  })

  it('caps the list so it stays a switcher', async () => {
    for (let n = 0; n < 15; n += 1) await addRecentFolder(path.join(vaultA, `folder-${n}`))
    expect(getSettings().recentFolders).toHaveLength(10)
  })

  it('refuses to record, and therefore to grant, a folder never opened', async () => {
    const unopened = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-unopened-'))
    await expect(addRecentFolder(unopened)).rejects.toThrow(/EPERM/)
    expect(getSettings().recentFolders).toEqual([])
    await expect(assertReadableDir(unopened)).rejects.toThrow(/EPERM/)
    await fs.rm(unopened, { recursive: true, force: true })
  })

  it('re-grants stored folders on the next launch', async () => {
    const revisited = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-c-')))
    patchSettings({ recentFolders: [revisited] })
    grantPersistedRecents()
    await expect(assertReadableDir(revisited)).resolves.toBe(revisited)
    await fs.rm(revisited, { recursive: true, force: true })
  })

  it('drops folders that have gone away rather than offering them', async () => {
    const doomed = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-gone-')))
    grantRoot(doomed)
    await addRecentFolder(vaultA)
    await addRecentFolder(doomed)
    await fs.rm(doomed, { recursive: true, force: true })

    expect(await listRecentFolders()).toEqual([vaultA])
    expect(getSettings().recentFolders).toEqual([vaultA])
  })

  it('rejects a path that is not absolute', async () => {
    await expect(addRecentFolder('notes')).rejects.toThrow()
    await expect(addRecentFolder(42)).rejects.toThrow()
  })

  it('keeps a folder it cannot reach right now', async () => {
    // An unplugged drive or a sleeping share is a temporary condition, and
    // dropping the vault over one would be unrecoverable from the switcher.
    await addRecentFolder(vaultA)
    const stat = vi.spyOn(fs, 'stat').mockRejectedValue(
      Object.assign(new Error('EIO'), { code: 'EIO' }),
    )
    expect(await listRecentFolders()).toEqual([vaultA])
    expect(getSettings().recentFolders).toEqual([vaultA])
    stat.mockRestore()
  })

  it('tells every window when the list changes', async () => {
    await addRecentFolder(vaultA)
    expect(sent.map(([channel]) => channel)).toContain('host:recentFoldersChanged')
    expect(sent.at(-1)?.[1]).toEqual([vaultA])

    sent.length = 0
    clearRecentFolders()
    expect(sent.at(-1)).toEqual(['host:recentFoldersChanged', []])
  })

  it('clears the whole list', async () => {
    await addRecentFolder(vaultA)
    clearRecentFolders()
    expect(await listRecentFolders()).toEqual([])
  })
})

describe('recent folders hardening', () => {
  const submenuLabels = (): string[] => {
    buildApplicationMenu()
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as Array<{
      label?: string
      submenu?: Array<{ label?: string; submenu?: Array<{ label?: string }> }>
    }>
    const file = template.find((entry) => entry.label === 'File')
    const recent = file?.submenu?.find((entry) => entry.label === 'Open Recent Folder')
    return (recent?.submenu ?? []).map((entry) => entry.label ?? '')
  }

  it.each([
    ['a string', 'oops'],
    ['an object', { 0: '/' }],
    ['a number', 7],
    ['null', null],
    ['an array of non-strings', [1, null, { path: '/' }, ['/']]],
  ])('survives settings.json holding %s as recentFolders', async (_label, junk) => {
    await fs.writeFile(
      path.join(USER_DATA, 'settings.json'),
      JSON.stringify({ recentFolders: junk }),
    )
    loadSettings()
    expect(getSettings().recentFolders).toEqual([])
    expect(await listRecentFolders()).toEqual([])
    expect(submenuLabels()).toEqual([])
    // And the per-launch grant has nothing to hand out.
    expect(() => grantPersistedRecents()).not.toThrow()
  })

  it('keeps only the strings of a partly valid list', async () => {
    await fs.writeFile(
      path.join(USER_DATA, 'settings.json'),
      JSON.stringify({ recentFolders: [vaultA, 5, null, vaultB] }),
    )
    loadSettings()
    expect(getSettings().recentFolders).toEqual([vaultA, vaultB])
    expect(submenuLabels()).toHaveLength(2)
  })

  it('does not overwrite a folder opened while the stats were in flight', async () => {
    await addRecentFolder(vaultA)
    const realStat = fs.stat.bind(fs)
    const stat = vi.spyOn(fs, 'stat').mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
      // A folder is opened in another window while this one is still checking.
      await addRecentFolder(vaultB)
      return realStat(...args)
    })
    await listRecentFolders()
    stat.mockRestore()
    expect(getSettings().recentFolders).toEqual([vaultB, vaultA])
  })

  it('does not wait on a folder whose stat never answers, and does not forget it', async () => {
    vi.useFakeTimers()
    try {
      await addRecentFolder(vaultA)
      const stat = vi.spyOn(fs, 'stat').mockImplementation(() => new Promise(() => {}))
      const listing = listRecentFolders()
      await vi.advanceTimersByTimeAsync(5000)
      expect(await listing).toEqual([vaultA])
      expect(getSettings().recentFolders).toEqual([vaultA])
      stat.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
