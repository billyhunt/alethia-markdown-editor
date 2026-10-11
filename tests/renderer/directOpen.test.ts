import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentStore } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore } from '../../src/renderer/state/workspaceStore.ts'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  recentsAdd: vi.fn(),
  documentWatch: vi.fn(),
  folderList: vi.fn(),
  setDocument: vi.fn(),
  refreshPreview: vi.fn(),
  revealDocument: vi.fn(),
  confirmSaveChanges: vi.fn(),
  rerouteOpen: vi.fn(),
  settleOpen: vi.fn(),
  getText: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('../../src/renderer/api.ts', () => ({
  api: {
    dialog: {
      confirmSaveChanges: mocks.confirmSaveChanges,
      showError: mocks.showError,
      openFile: vi.fn(),
      openFolder: vi.fn(),
      saveAs: vi.fn(),
    },
    fs: { readFile: mocks.readFile, writeFile: vi.fn() },
    recents: { add: mocks.recentsAdd },
    document: { watch: mocks.documentWatch, unwatch: vi.fn() },
    folder: { list: mocks.folderList, watch: vi.fn() },
    window: {
      revealDocument: mocks.revealDocument,
      rerouteOpen: mocks.rerouteOpen,
      settleOpen: mocks.settleOpen,
    },
  },
  unwrapIpcError: (error: unknown) => String(error),
}))

vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    setDocument: mocks.setDocument,
    refreshPreview: mocks.refreshPreview,
    getText: mocks.getText,
  },
}))

import { openPath, openRouted } from '../../src/renderer/services/fileOps.ts'

const PATH = '/notes/today.md'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.revealDocument.mockResolvedValue(false)
  mocks.rerouteOpen.mockResolvedValue(undefined)
  mocks.settleOpen.mockResolvedValue(undefined)
  mocks.getText.mockReturnValue('')
  mocks.readFile.mockResolvedValue({
    path: PATH,
    content: '# Today',
    mtimeMs: 42,
    lineEnding: '\n',
  })
  useDocumentStore.getState().load({ filePath: null, text: '', mtimeMs: null })
  useWorkspaceStore.setState({ folderRoot: null, tree: null, truncated: false, sidebarVisible: true })
})

describe('document-first openPath', () => {
  it('opens a direct file without adopting its parent folder and clears only the transient sidebar', async () => {
    await openPath(PATH, { preferDocument: true })

    expect(mocks.readFile).toHaveBeenCalledWith(PATH)
    expect(mocks.folderList).not.toHaveBeenCalled()
    expect(mocks.setDocument).toHaveBeenCalledWith('# Today')
    expect(mocks.refreshPreview).toHaveBeenCalledOnce()
    expect(mocks.documentWatch).toHaveBeenCalledWith(PATH)
    expect(useDocumentStore.getState().filePath).toBe(PATH)
    expect(useWorkspaceStore.getState().folderRoot).toBeNull()
    expect(useWorkspaceStore.getState().sidebarVisible).toBe(false)
  })

  it('keeps the sidebar state when opening from an existing UI context', async () => {
    await openPath(PATH)

    expect(mocks.folderList).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().sidebarVisible).toBe(true)
  })

  it('brings forward the window already showing the file instead of opening a second copy', async () => {
    mocks.revealDocument.mockResolvedValue(true)
    useDocumentStore.getState().load({ filePath: '/notes/other.md', text: 'saved', mtimeMs: 1 })
    useDocumentStore.getState().setDirty(true)

    await openPath(PATH)

    expect(mocks.revealDocument).toHaveBeenCalledWith(PATH)
    expect(mocks.readFile).not.toHaveBeenCalled()
    // Nothing is replaced here, so there is nothing to ask about.
    expect(mocks.confirmSaveChanges).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().filePath).toBe('/notes/other.md')
  })

  it('skips the cross-window check for an open main already routed here', async () => {
    await openPath(PATH, { preferDocument: true, routed: true })

    expect(mocks.revealDocument).not.toHaveBeenCalled()
    expect(mocks.readFile).toHaveBeenCalledWith(PATH)
  })
})

describe('opens routed here by main', () => {
  it('opens the file and releases the reservation', async () => {
    await openRouted({ path: PATH, kind: 'file' })

    expect(mocks.revealDocument).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().filePath).toBe(PATH)
    expect(mocks.settleOpen).toHaveBeenCalledOnce()
  })

  it('releases the reservation even when the file cannot be read', async () => {
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))

    await openRouted({ path: PATH, kind: 'file' })

    expect(mocks.settleOpen).toHaveBeenCalledOnce()
  })

  it('passes the file back rather than prompting over text typed since main last heard', async () => {
    // The store has not caught up with the keystrokes yet; the editor has.
    mocks.getText.mockReturnValue('a draft')

    await openRouted({ path: PATH, kind: 'file' })

    expect(mocks.rerouteOpen).toHaveBeenCalledWith(PATH)
    expect(mocks.confirmSaveChanges).not.toHaveBeenCalled()
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().filePath).toBeNull()
  })

  it('says so when main refuses the hand-back, rather than dropping the open', async () => {
    mocks.getText.mockReturnValue('a draft')
    mocks.rerouteOpen.mockRejectedValue(new Error('EPERM'))

    await openRouted({ path: PATH, kind: 'file' })

    expect(mocks.showError).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not open file' }))
  })

  it('releases the reservation after adopting a routed folder', async () => {
    mocks.folderList.mockResolvedValue({ root: '/notes', children: [] })

    await openRouted({ path: '/notes', kind: 'dir' })

    expect(mocks.settleOpen).toHaveBeenCalledOnce()
  })
})
