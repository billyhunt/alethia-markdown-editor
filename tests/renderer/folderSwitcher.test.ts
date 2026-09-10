import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  dialog: { openFolder: vi.fn(), showError: vi.fn() },
  folder: { list: vi.fn(), watch: vi.fn() },
  recents: { addFolder: vi.fn(), listFolders: vi.fn() },
  menu: { folderSwitcher: vi.fn() },
}))
vi.mock('../../src/renderer/api.ts', () => ({ api: host, unwrapIpcError: String }))
vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: { getText: () => '', setDocument: () => undefined },
}))

import { adoptFolder, switchFolder } from '../../src/renderer/services/fileOps.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'

const vaultA = '/vaults/notes'
const vaultB = '/vaults/work'

beforeEach(() => {
  vi.resetAllMocks()
  workspace.setState({ folderRoot: null, tree: null, recentFolders: [] })
  host.folder.list.mockImplementation((root: string) =>
    Promise.resolve({ root, tree: { name: 'x', path: root, kind: 'dir' }, truncated: false }),
  )
  host.recents.listFolders.mockResolvedValue([vaultA, vaultB])
})

describe('opening a folder', () => {
  it('records it as somewhere to switch back to', async () => {
    await adoptFolder(vaultA)
    expect(workspace.getState().folderRoot).toBe(vaultA)
    expect(host.recents.addFolder).toHaveBeenCalledWith(vaultA)
    expect(workspace.getState().recentFolders).toEqual([vaultA, vaultB])
  })

  it('reports a folder it cannot read instead of half-adopting it', async () => {
    host.folder.list.mockRejectedValue(new Error('EPERM'))
    await adoptFolder('/vaults/gone')
    expect(workspace.getState().folderRoot).toBeNull()
    expect(host.recents.addFolder).not.toHaveBeenCalled()
    expect(host.dialog.showError).toHaveBeenCalled()
  })
})

describe('the workspace switcher', () => {
  it('swaps the workspace for the chosen folder, keeping the open document', async () => {
    workspace.setState({ folderRoot: vaultA })
    host.menu.folderSwitcher.mockResolvedValue({ action: 'switch', path: vaultB })

    await switchFolder()
    expect(host.menu.folderSwitcher).toHaveBeenCalledWith({ current: vaultA })
    expect(host.folder.list).toHaveBeenCalledWith(vaultB)
    expect(host.folder.watch).toHaveBeenCalledWith(vaultB)
    expect(workspace.getState().folderRoot).toBe(vaultB)
  })

  it('falls through to the directory dialog', async () => {
    host.menu.folderSwitcher.mockResolvedValue({ action: 'open' })
    host.dialog.openFolder.mockResolvedValue(vaultB)

    await switchFolder()
    expect(workspace.getState().folderRoot).toBe(vaultB)
  })

  it('does nothing when dismissed', async () => {
    workspace.setState({ folderRoot: vaultA })
    host.menu.folderSwitcher.mockResolvedValue({ action: 'cancelled' })

    await switchFolder()
    expect(host.folder.list).not.toHaveBeenCalled()
    expect(workspace.getState().folderRoot).toBe(vaultA)
  })

  it('reflects a cleared list', async () => {
    workspace.setState({ recentFolders: [vaultA, vaultB] })
    host.menu.folderSwitcher.mockResolvedValue({ action: 'cleared' })
    host.recents.listFolders.mockResolvedValue([])

    await switchFolder()
    expect(workspace.getState().recentFolders).toEqual([])
  })
})
