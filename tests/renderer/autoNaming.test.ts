import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  dialog: { saveAs: vi.fn(), showError: vi.fn() },
  fs: { createFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), readFile: vi.fn() },
  folder: { list: vi.fn() },
  document: { watch: vi.fn(), unwatch: vi.fn() },
  recents: { add: vi.fn(), addFolder: vi.fn(), listFolders: vi.fn() },
}))
vi.mock('../../src/renderer/api.ts', () => ({ api: host, unwrapIpcError: String }))
const buffer = vi.hoisted(() => ({ text: '' }))
vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    getText: () => buffer.text,
    setDocument: (text: string) => { buffer.text = text },
  },
}))

import {
  forgetTrashedFile,
  newDocument,
  autoFileRetryable,
  autoNamePending,
  renameFile,
  save,
  saveAs,
  saveNewByTitle,
  syncAutoName,
} from '../../src/renderer/services/fileOps.ts'
import { handleFileChange } from '../../src/renderer/services/externalChanges.ts'
import { useDocumentStore as docs } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'

beforeEach(() => {
  vi.resetAllMocks()
  buffer.text = ''
  docs.getState().load({ filePath: null, text: '', mtimeMs: null })
  workspace.setState({ folderRoot: '/notes', tree: null, notice: null })
  host.folder.list.mockResolvedValue({ root: '/notes', tree: null, truncated: false })
  host.fs.writeFile.mockResolvedValue({ ok: true, mtimeMs: 10 })
  host.document.watch.mockResolvedValue('doc-1')
  host.document.unwatch.mockResolvedValue(undefined)
  host.recents.add.mockResolvedValue(undefined)
})

describe('saving a new document under its title', () => {
  it('files it in the open folder without asking, content and all', async () => {
    buffer.text = '# Weekly review\n\nSomething worth keeping.\n'
    docs.getState().setDirty(true)
    host.fs.createFile.mockResolvedValue({ path: '/notes/Weekly review.md', mtimeMs: 10 })

    expect(await saveNewByTitle()).toBe(true)
    expect(host.fs.createFile).toHaveBeenCalledWith({
      dir: '/notes',
      name: 'Weekly review.md',
      content: buffer.text,
      lineEnding: '\n',
    })
    expect(host.dialog.saveAs).not.toHaveBeenCalled()
    // The content went in with the create; no second write to leave an
    // empty file behind if it failed.
    expect(host.fs.writeFile).not.toHaveBeenCalled()
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Weekly review.md',
      savedText: buffer.text,
      mtimeMs: 10,
      dirty: false,
      namedByTitle: true,
    })
    expect(host.document.watch).toHaveBeenCalledWith('/notes/Weekly review.md')
  })

  it('lets main pick the folder when no workspace is open', async () => {
    workspace.setState({ folderRoot: null })
    buffer.text = 'Loose thought\n'
    host.fs.createFile.mockResolvedValue({
      path: '/Users/x/Documents/Alethia/Loose thought.md',
      mtimeMs: 3,
    })

    expect(await saveNewByTitle()).toBe(true)
    expect(host.fs.createFile).toHaveBeenCalledWith({
      dir: null,
      name: 'Loose thought.md',
      content: 'Loose thought\n',
      lineEnding: '\n',
    })
  })

  it('leaves the buffer dirty when typing continued during the write', async () => {
    buffer.text = '# Draft\n'
    host.fs.createFile.mockImplementation(async () => {
      buffer.text = '# Draft\n\nmore typing\n'
      return { path: '/notes/Draft.md', mtimeMs: 4 }
    })

    expect(await saveNewByTitle()).toBe(true)
    expect(docs.getState()).toMatchObject({ savedText: '# Draft\n', dirty: true })
  })

  it('does not claim the new path for a document opened while it was writing', async () => {
    buffer.text = '# Abandoned\n'
    host.fs.createFile.mockImplementation(async () => {
      // The user opens something else before the file comes back.
      docs.getState().load({ filePath: '/notes/Other.md', text: '# Other\n', mtimeMs: 2 })
      return { path: '/notes/Abandoned.md', mtimeMs: 5 }
    })

    expect(await saveNewByTitle()).toBe(false)
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Other.md',
      savedText: '# Other\n',
      namedByTitle: false,
    })
    expect(host.document.watch).not.toHaveBeenCalledWith('/notes/Abandoned.md')
  })

  it('files an empty buffer left behind by trashing a file', async () => {
    docs.getState().load({ filePath: '/notes/Gone.md', text: '# Gone\n', mtimeMs: 1 })
    buffer.text = '# Gone\n'
    forgetTrashedFile('/notes/Gone.md')
    expect(docs.getState().autoNameable).toBe(true)

    buffer.text = '# Something new\n'
    host.fs.createFile.mockResolvedValue({ path: '/notes/Something new.md', mtimeMs: 6 })
    expect(await saveNewByTitle()).toBe(true)
  })

  it('refuses to re-create edits rescued from a trashed file', async () => {
    docs.getState().load({ filePath: '/notes/Gone.md', text: '# Gone\n', mtimeMs: 1 })
    buffer.text = '# Gone\n\nunsaved work\n'
    forgetTrashedFile('/notes/Gone.md')
    expect(docs.getState().autoNameable).toBe(false)

    expect(await saveNewByTitle()).toBe(false)
    expect(host.fs.createFile).not.toHaveBeenCalled()
  })

  it('files a document started with File > New', async () => {
    docs.getState().load({ filePath: null, text: '# Tour\n', mtimeMs: null, autoNameable: false })
    await newDocument()
    expect(docs.getState().autoNameable).toBe(true)
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

  it('says so at the first failure, and offers to try again by itself a few times', async () => {
    buffer.text = '# Notes\n'
    host.fs.createFile.mockRejectedValue(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    )

    await saveNewByTitle()
    expect(workspace.getState().notice?.message).toMatch(/could not be saved automatically/)
    expect(autoFileRetryable()).toBe(true)
    await saveNewByTitle()
    await saveNewByTitle()
    // After that only a further edit tries again, rather than hammering a
    // disk that is not coming back.
    expect(autoFileRetryable()).toBe(false)
  })

  it('clears the notice and stops retrying once the file is created', async () => {
    buffer.text = '# Notes\n'
    host.fs.createFile.mockRejectedValueOnce(new Error('EIO'))
    await saveNewByTitle()
    expect(workspace.getState().notice).not.toBeNull()

    host.fs.createFile.mockResolvedValue({ path: '/notes/Notes.md', mtimeMs: 4 })
    expect(await saveNewByTitle()).toBe(true)
    expect(workspace.getState().notice).toBeNull()
    expect(autoFileRetryable()).toBe(false)
  })

  it('does not count one buffer\'s failures against the next', async () => {
    buffer.text = '# Notes\n'
    host.fs.createFile.mockRejectedValue(new Error('EIO'))
    await saveNewByTitle()
    await saveNewByTitle()
    await saveNewByTitle()
    expect(autoFileRetryable()).toBe(false)

    docs.getState().load({ filePath: null, text: '', mtimeMs: null })
    await saveNewByTitle()
    expect(autoFileRetryable()).toBe(true)
  })

  it('tells main about the new file before the editor learns its path', async () => {
    buffer.text = '# Ordered\n'
    host.fs.createFile.mockResolvedValue({ path: '/notes/Ordered.md', mtimeMs: 2 })
    let pathWhenWatched: string | null | undefined
    host.document.watch.mockImplementation(async () => {
      pathWhenWatched = docs.getState().filePath
      return 'doc-new'
    })

    await saveNewByTitle()
    // An image request that beat this would be refused as "not open".
    expect(pathWhenWatched).toBeNull()
    expect(docs.getState()).toMatchObject({ filePath: '/notes/Ordered.md', documentId: 'doc-new' })
  })

  it('still adopts a file it created when watching it fails', async () => {
    // Otherwise the path would stay unpublished and the next pass would
    // create a second file for the same text.
    buffer.text = '# Watched\n'
    host.fs.createFile.mockResolvedValue({ path: '/notes/Watched.md', mtimeMs: 2 })
    host.document.watch.mockRejectedValue(new Error('EPERM'))

    expect(await saveNewByTitle()).toBe(true)
    expect(docs.getState()).toMatchObject({ filePath: '/notes/Watched.md', documentId: null })
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
    host.fs.rename.mockResolvedValue({ path: '/notes/Weekly review.md' })

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

  it('tells main about the new name before the editor learns it, and keeps the document id', async () => {
    buffer.text = '# Weekly review\n'
    host.fs.rename.mockResolvedValue({ path: '/notes/Weekly review.md' })
    let pathWhenWatched: string | null | undefined
    host.document.watch.mockImplementation(async () => {
      pathWhenWatched = docs.getState().filePath
      return 'doc-renamed'
    })

    await syncAutoName()
    expect(pathWhenWatched).toBe('/notes/Weekly.md')
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Weekly review.md',
      documentId: 'doc-renamed',
    })
  })

  it('still follows the file when watching the new name fails', async () => {
    // The file has moved on disk; leaving the document on the old name would
    // make the next save recreate it.
    buffer.text = '# Weekly review\n'
    host.fs.rename.mockResolvedValue({ path: '/notes/Weekly review.md' })
    host.document.watch.mockRejectedValue(new Error('EPERM'))

    await syncAutoName()
    expect(docs.getState().filePath).toBe('/notes/Weekly review.md')
  })

  it('reports whether the title and the file name have drifted apart, dirty or not', () => {
    expect(autoNamePending()).toBe(false)
    buffer.text = '# Weekly review\n'
    expect(docs.getState().dirty).toBe(false)
    expect(autoNamePending()).toBe(true)
  })

  it('holds a save back while the rename is in flight, then writes the new name only', async () => {
    buffer.text = '# Weekly review\n'
    docs.getState().setDirty(true)
    let finishRename!: () => void
    host.fs.rename.mockImplementation(
      () => new Promise((resolve) => { finishRename = () => resolve({ path: '/notes/Weekly review.md' }) }),
    )

    const renaming = syncAutoName()
    await vi.waitFor(() => expect(host.fs.rename).toHaveBeenCalled())
    const saving = save()
    await new Promise((resolve) => setTimeout(resolve, 20))
    // Aimed at the old name now, it would be refused as stale -- or, worse,
    // recreate the file the rename just moved.
    expect(host.fs.writeFile).not.toHaveBeenCalled()

    finishRename()
    await renaming
    expect(await saving).toBe(true)
    expect(host.fs.writeFile).toHaveBeenCalledTimes(1)
    expect(host.fs.writeFile.mock.calls[0][0]).toBe('/notes/Weekly review.md')
    expect(docs.getState()).toMatchObject({ filePath: '/notes/Weekly review.md', dirty: false })
  })

  it('lets a save already in flight finish before renaming the file under it', async () => {
    buffer.text = '# Weekly review\n'
    docs.getState().setDirty(true)
    let finishWrite!: () => void
    host.fs.writeFile.mockImplementation(
      () => new Promise((resolve) => { finishWrite = () => resolve({ ok: true, mtimeMs: 11 }) }),
    )
    host.fs.rename.mockResolvedValue({ path: '/notes/Weekly review.md' })

    const saving = save()
    await vi.waitFor(() => expect(host.fs.writeFile).toHaveBeenCalled())
    const renaming = syncAutoName()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.fs.rename).not.toHaveBeenCalled()

    finishWrite()
    await saving
    await renaming
    expect(host.fs.writeFile).toHaveBeenCalledTimes(1)
    expect(host.fs.writeFile.mock.calls[0][0]).toBe('/notes/Weekly.md')
    expect(host.fs.rename).toHaveBeenCalledWith('/notes/Weekly.md', 'Weekly review.md')
    expect(docs.getState().filePath).toBe('/notes/Weekly review.md')
  })

  it('stays put when the title still matches, or has gone away', async () => {
    buffer.text = '# Weekly\n\nedits\n'
    await syncAutoName()
    buffer.text = '\n'
    await syncAutoName()
    expect(host.fs.rename).not.toHaveBeenCalled()
  })

  it('does not repoint a document that was replaced while renaming', async () => {
    buffer.text = '# Weekly review\n'
    host.fs.rename.mockImplementation(async () => {
      docs.getState().load({ filePath: '/notes/Other.md', text: '# Other\n', mtimeMs: 2 })
      return { path: '/notes/Weekly review.md' }
    })

    await syncAutoName()
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Other.md',
      namedByTitle: false,
    })
  })

  it('keeps following the title after an external reload', async () => {
    host.fs.readFile.mockResolvedValue({ content: '# Weekly\nedited elsewhere\n', mtimeMs: 20, lineEnding: '\n' })
    await handleFileChange({ path: '/notes/Weekly.md', kind: 'changed', mtimeMs: 20 })
    expect(docs.getState()).toMatchObject({ namedByTitle: true, mtimeMs: 20 })
  })

  it('keeps the current name when the new one is taken, and stops asking', async () => {
    buffer.text = '# Taken\n'
    host.fs.rename.mockRejectedValue(new Error('EEXIST: "Taken.md" already exists'))

    await syncAutoName()
    expect(docs.getState().filePath).toBe('/notes/Weekly.md')
    expect(host.dialog.showError).not.toHaveBeenCalled()

    // Asking again every two seconds would achieve nothing, and would claim
    // the name behind the user's back the moment it came free.
    host.fs.rename.mockClear()
    await syncAutoName()
    expect(host.fs.rename).not.toHaveBeenCalled()
  })

  it('does not chase the plain name after its own name was numbered', async () => {
    // The title wanted Taken.md; the folder already had one, so main
    // numbered it. The document must not spend the rest of the session
    // trying to rename itself onto the name it did not get.
    docs.getState().load({ filePath: null, text: '', mtimeMs: null })
    buffer.text = '# Taken\n'
    host.fs.createFile.mockResolvedValue({ path: '/notes/Taken 2.md', mtimeMs: 8 })
    expect(await saveNewByTitle()).toBe(true)
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Taken 2.md',
      autoNameBase: 'Taken.md',
    })

    await syncAutoName()
    expect(host.fs.rename).not.toHaveBeenCalled()

    // A genuinely new title still moves it.
    buffer.text = '# Taken later\n'
    host.fs.rename.mockResolvedValue({ path: '/notes/Taken later.md' })
    await syncAutoName()
    expect(host.fs.rename).toHaveBeenCalledWith('/notes/Taken 2.md', 'Taken later.md')
  })

  it('stops following the title once the user names the file themselves', async () => {
    host.fs.rename.mockResolvedValue({ path: '/notes/My name.md' })
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
