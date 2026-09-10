import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  dialog: { saveAs: vi.fn(), showError: vi.fn() },
  fs: { createFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn() },
  folder: { list: vi.fn() },
  document: { watch: vi.fn(), unwatch: vi.fn() },
  recents: { add: vi.fn() },
}))
vi.mock('../../src/renderer/api.ts', () => ({ api: host, unwrapIpcError: String }))
const buffer = vi.hoisted(() => ({ text: '' }))
vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    getText: () => buffer.text,
    setDocument: (text: string) => { buffer.text = text },
  },
}))

import { renameFile, saveAs, saveNewByTitle, syncAutoName } from '../../src/renderer/services/fileOps.ts'
import { useDocumentStore as docs } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'

beforeEach(() => {
  vi.resetAllMocks()
  buffer.text = ''
  docs.getState().load({ filePath: null, text: '', mtimeMs: null })
  workspace.setState({ folderRoot: '/notes', tree: null, notice: null })
  host.folder.list.mockResolvedValue({ root: '/notes', tree: null, truncated: false })
  host.fs.writeFile.mockResolvedValue({ ok: true, mtimeMs: 10 })
})

describe('saving a new document under its title', () => {
  it('files it in the open folder without asking', async () => {
    buffer.text = '# Weekly review\n\nSomething worth keeping.\n'
    docs.getState().setDirty(true)
    host.fs.createFile.mockResolvedValue('/notes/Weekly review.md')

    expect(await saveNewByTitle()).toBe(true)
    expect(host.fs.createFile).toHaveBeenCalledWith({
      dir: '/notes',
      name: 'Weekly review.md',
    })
    expect(host.dialog.saveAs).not.toHaveBeenCalled()
    expect(host.fs.writeFile).toHaveBeenCalledWith('/notes/Weekly review.md', buffer.text, {
      expectedMtimeMs: null,
      lineEnding: '\n',
    })
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Weekly review.md',
      dirty: false,
      namedByTitle: true,
    })
    expect(host.document.watch).toHaveBeenCalledWith('/notes/Weekly review.md')
  })

  it('lets main pick the folder when no workspace is open', async () => {
    workspace.setState({ folderRoot: null })
    buffer.text = 'Loose thought\n'
    host.fs.createFile.mockResolvedValue('/Users/x/Documents/Alethia/Loose thought.md')

    expect(await saveNewByTitle()).toBe(true)
    expect(host.fs.createFile).toHaveBeenCalledWith({ dir: null, name: 'Loose thought.md' })
  })

  it('waits for a title rather than creating Untitled.md', async () => {
    buffer.text = '\n\n   \n'
    expect(await saveNewByTitle()).toBe(false)
    expect(host.fs.createFile).not.toHaveBeenCalled()
    expect(docs.getState().filePath).toBeNull()
  })

  it('leaves the buffer untouched when the file cannot be created', async () => {
    buffer.text = '# Notes\n'
    host.fs.createFile.mockRejectedValue(new Error('EPERM'))

    expect(await saveNewByTitle()).toBe(false)
    expect(docs.getState().filePath).toBeNull()
    expect(host.dialog.showError).not.toHaveBeenCalled()
  })

  it('does nothing for a document that already has a path', async () => {
    docs.getState().load({ filePath: '/notes/Existing.md', text: '', mtimeMs: 1 })
    buffer.text = '# Renamed later\n'
    expect(await saveNewByTitle()).toBe(false)
    expect(host.fs.createFile).not.toHaveBeenCalled()
  })
})

describe('keeping an automatic name in step with the title', () => {
  beforeEach(() => {
    docs.getState().load({
      filePath: '/notes/Weekly.md', text: '# Weekly\n', mtimeMs: 10, namedByTitle: true,
    })
  })

  it('renames the file when the title changes, keeping unsaved edits', async () => {
    buffer.text = '# Weekly review\n\nmore\n'
    docs.getState().setDirty(true)
    host.fs.rename.mockResolvedValue('/notes/Weekly review.md')

    await syncAutoName()
    expect(host.fs.rename).toHaveBeenCalledWith('/notes/Weekly.md', 'Weekly review.md')
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Weekly review.md',
      savedText: '# Weekly\n',
      mtimeMs: 10,
      dirty: true,
      namedByTitle: true,
    })
    expect(host.document.watch).toHaveBeenCalledWith('/notes/Weekly review.md')
  })

  it('stays put when the title still matches, or has gone away', async () => {
    buffer.text = '# Weekly\n\nedits\n'
    await syncAutoName()
    buffer.text = '\n'
    await syncAutoName()
    expect(host.fs.rename).not.toHaveBeenCalled()
  })

  it('keeps the current name when the new one is taken', async () => {
    buffer.text = '# Taken\n'
    host.fs.rename.mockRejectedValue(new Error('EEXIST: "Taken.md" already exists'))

    await syncAutoName()
    expect(docs.getState().filePath).toBe('/notes/Weekly.md')
    expect(host.dialog.showError).not.toHaveBeenCalled()
  })

  it('stops following the title once the user names the file themselves', async () => {
    host.fs.rename.mockResolvedValue('/notes/My name.md')
    await renameFile('/notes/Weekly.md', 'My name')
    expect(docs.getState().namedByTitle).toBe(false)

    buffer.text = '# Something else\n'
    host.fs.rename.mockClear()
    await syncAutoName()
    expect(host.fs.rename).not.toHaveBeenCalled()
  })

  it('stops following the title after Save As', async () => {
    buffer.text = '# Weekly\n'
    host.dialog.saveAs.mockResolvedValue('/elsewhere/Chosen.md')
    expect(await saveAs()).toBe(true)
    expect(docs.getState()).toMatchObject({ filePath: '/elsewhere/Chosen.md', namedByTitle: false })
  })
})
