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
}))

vi.mock('../../src/renderer/api.ts', () => ({
  api: {
    dialog: {
      confirmSaveChanges: vi.fn(),
      showError: vi.fn(),
      openFile: vi.fn(),
      openFolder: vi.fn(),
      saveAs: vi.fn(),
    },
    fs: { readFile: mocks.readFile, writeFile: vi.fn() },
    recents: { add: mocks.recentsAdd },
    document: { watch: mocks.documentWatch, unwatch: vi.fn() },
    folder: { list: mocks.folderList, watch: vi.fn() },
  },
  unwrapIpcError: (error: unknown) => String(error),
}))

vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    setDocument: mocks.setDocument,
    refreshPreview: mocks.refreshPreview,
    getText: vi.fn(),
  },
}))

import { openPath } from '../../src/renderer/services/fileOps.ts'

const PATH = '/notes/today.md'

beforeEach(() => {
  vi.clearAllMocks()
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
})
