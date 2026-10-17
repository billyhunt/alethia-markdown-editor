import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  dialog: {
    confirmSaveChanges: vi.fn(), openFile: vi.fn(), saveAs: vi.fn(), showError: vi.fn(),
  },
  fs: { readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn() },
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

import {
  closeDocument, ensureClosable, forgetTrashedFile, openFileDialog, openPath, renameFile, save,
} from '../../src/renderer/services/fileOps.ts'
import { handleFileChange } from '../../src/renderer/services/externalChanges.ts'
import { useDocumentStore as docs } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'

const file = '/test/deleted.md'
const next = '/test/next.md'

beforeEach(() => {
  vi.resetAllMocks()
  buffer.text = '# Saved\n'
  docs.getState().load({ filePath: file, text: buffer.text, mtimeMs: 1, lineEnding: '\r\n' })
  workspace.setState({ folderRoot: '/test', notice: null })
  host.fs.readFile.mockResolvedValue({ content: '# Next\n', mtimeMs: 2, lineEnding: '\n' })
  host.dialog.confirmSaveChanges.mockResolvedValue('cancel')
})

describe('intentional deletion of the open file', () => {
  it.each(['', '# Saved\n'])('closes a saved file without trapping navigation (%j)', async (text) => {
    buffer.text = text
    docs.getState().load({ filePath: file, text, mtimeMs: 1 })
    forgetTrashedFile(file)
    expect(buffer.text).toBe('')
    expect(docs.getState()).toMatchObject({ filePath: null, dirty: false, savedText: '' })
    expect(host.document.unwatch).toHaveBeenCalledOnce()
    workspace.getState().notice!.actions.find(a => a.label === 'Dismiss')!.run()
    expect(workspace.getState().notice).toBeNull()
    await openPath(next)
    expect(host.dialog.confirmSaveChanges).not.toHaveBeenCalled()
    expect(docs.getState().filePath).toBe(next)
    expect(buffer.text).toBe('# Next\n')
  })

  it('preserves edits made just before deletion, even before the dirty flag updates', async () => {
    buffer.text += 'New unsaved work\n'
    expect(docs.getState().dirty).toBe(false)
    forgetTrashedFile(file)
    expect(buffer.text).toContain('New unsaved work')
    expect(docs.getState()).toMatchObject({
      filePath: null, dirty: true, savedText: '', lineEnding: '\r\n',
    })
    expect(workspace.getState().notice!.actions.map(a => a.label)).toContain('Save As')
    expect(await ensureClosable()).toBe(false)
    expect(buffer.text).toContain('New unsaved work')
    host.dialog.saveAs.mockResolvedValue('/test/recovered.md')
    host.fs.writeFile.mockResolvedValue({ ok: true, mtimeMs: 3 })
    expect(await save()).toBe(true)
    expect(host.fs.writeFile).toHaveBeenCalledWith('/test/recovered.md', buffer.text, {
      expectedMtimeMs: null, lineEnding: '\r\n',
    })
    expect(workspace.getState().notice).toBeNull()
  })

  it('does not turn a cleared buffer into an unsaved empty file', () => {
    buffer.text = ''
    docs.getState().setDirty(true)
    forgetTrashedFile(file)
    expect(docs.getState().dirty).toBe(false)
  })

  it('leaves a different open file alone', () => {
    forgetTrashedFile('/test/other.md')
    expect(docs.getState().filePath).toBe(file)
    expect(buffer.text).toBe('# Saved\n')
    expect(host.document.unwatch).not.toHaveBeenCalled()
  })

  it('ignores a late filesystem removal event after the intentional trash', async () => {
    forgetTrashedFile(file)
    workspace.getState().setNotice(null)
    await handleFileChange({ path: file, kind: 'removed' })
    expect(workspace.getState().notice).toBeNull()
    expect(docs.getState().dirty).toBe(false)
  })

  it('asks only once when discarding retained edits to open another file', async () => {
    buffer.text += 'Unsaved\n'
    forgetTrashedFile(file)
    host.dialog.openFile.mockResolvedValue(next)
    host.dialog.confirmSaveChanges.mockResolvedValue('dontSave')
    await openFileDialog()
    expect(host.dialog.confirmSaveChanges).toHaveBeenCalledTimes(1)
    expect(docs.getState().filePath).toBe(next)
    expect(workspace.getState().notice).toBeNull()
  })

  it('clears the deletion notice when closing retained edits', async () => {
    buffer.text += 'Unsaved\n'
    forgetTrashedFile(file)
    host.dialog.confirmSaveChanges.mockResolvedValue('dontSave')
    await closeDocument()
    expect(buffer.text).toBe('')
    expect(docs.getState().dirty).toBe(false)
    expect(workspace.getState().notice).toBeNull()
  })
})

describe('opening while document watch is pending', () => {
  it('updates document identity before awaiting the new watch', async () => {
    let finish!: (id: string) => void
    host.document.watch.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
    const opening = openPath(next)
    await vi.waitFor(() => expect(docs.getState().filePath).toBe(next))
    expect(buffer.text).toBe('# Next\n')
    expect(docs.getState().documentId).toBeNull()
    finish('next-doc-id')
    await opening
    expect(docs.getState().documentId).toBe('next-doc-id')
  })

  it('keeps the new document identity if watch setup fails', async () => {
    host.document.watch.mockRejectedValue(new Error('watch failed'))
    await openPath(next)
    expect(buffer.text).toBe('# Next\n')
    expect(docs.getState()).toMatchObject({ filePath: next, documentId: null })
    expect(host.dialog.showError).toHaveBeenCalledWith({ title: 'Could not open file', message: 'Error: watch failed' })
  })
})

it('preserves the current document ID when reloading that file after an external change', async () => {
  docs.setState({ documentId: 'current-document-id' })
  host.fs.readFile.mockResolvedValue({ content: '# Reloaded\n', mtimeMs: 8, lineEnding: '\n' })
  await handleFileChange({ path: file, kind: 'changed', mtimeMs: 8 })
  expect(docs.getState()).toMatchObject({
    filePath: file, documentId: 'current-document-id', savedText: '# Reloaded\n', dirty: false,
  })
})

describe('document IDs returned after a save or rename', () => {
  it('does not attach a saved file ID after switching documents during watch setup', async () => {
    let finish!: (id: string) => void
    host.fs.writeFile.mockResolvedValue({ ok: true, mtimeMs: 3 })
    host.document.watch.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
    const saving = save()
    await vi.waitFor(() => expect(host.document.watch).toHaveBeenCalledWith(file))
    docs.getState().load({ filePath: next, text: '# Another\n', mtimeMs: 4 })
    finish('stale-file-id')
    await saving
    expect(docs.getState()).toMatchObject({ filePath: next, documentId: null, savedText: '# Another\n' })
  })

  it('attaches a renamed file ID without resetting edits made during watch setup', async () => {
    let finish!: (id: string) => void
    host.fs.rename.mockResolvedValue(next)
    host.document.watch.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
    const renaming = renameFile(file, 'next.md')
    await vi.waitFor(() => expect(host.document.watch).toHaveBeenCalledWith(next))
    buffer.text += 'Unsaved while waiting\n'
    docs.getState().setDirty(true)
    finish('renamed-file-id')
    await renaming
    expect(docs.getState()).toMatchObject({
      filePath: next, documentId: 'renamed-file-id', savedText: '# Saved\n', dirty: true,
    })
  })

  it('does not attach a renamed file ID after switching documents during watch setup', async () => {
    let finish!: (id: string) => void
    host.fs.rename.mockResolvedValue(next)
    host.document.watch.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
    const renaming = renameFile(file, 'next.md')
    await vi.waitFor(() => expect(host.document.watch).toHaveBeenCalledWith(next))
    docs.getState().load({ filePath: '/test/other.md', text: '# Other\n', mtimeMs: 5 })
    finish('stale-renamed-id')
    await renaming
    expect(docs.getState()).toMatchObject({ filePath: '/test/other.md', documentId: null, savedText: '# Other\n' })
  })
})
