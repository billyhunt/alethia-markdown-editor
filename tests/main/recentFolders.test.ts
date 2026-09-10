import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-recentfolders-userdata')
vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, addRecentDocument: vi.fn(), clearRecentDocuments: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
  nativeTheme: {},
  screen: {},
}))

const { addRecentFolder, clearRecentFolders, listRecentFolders, grantPersistedRecents } =
  await import('../../src/main/recents.ts')
const { getSettings, patchSettings } = await import('../../src/main/settings.ts')
const { assertReadableDir, grantRoot } = await import('../../src/main/paths.ts')

let vaultA: string
let vaultB: string

beforeAll(async () => {
  vaultA = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-a-'))
  vaultB = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-b-'))
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
    const revisited = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-c-'))
    patchSettings({ recentFolders: [revisited] })
    grantPersistedRecents()
    await expect(assertReadableDir(revisited)).resolves.toBe(revisited)
    await fs.rm(revisited, { recursive: true, force: true })
  })

  it('drops folders that have gone away rather than offering them', async () => {
    const doomed = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-vault-gone-'))
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

  it('clears the whole list', async () => {
    await addRecentFolder(vaultA)
    clearRecentFolders()
    expect(await listRecentFolders()).toEqual([])
  })
})
