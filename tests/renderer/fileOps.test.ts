import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  dialog: {
    confirmSaveChanges: vi.fn(), openFile: vi.fn(), saveAs: vi.fn(), showError: vi.fn(),
  },
  fs: { readFile: vi.fn(), writeFile: vi.fn() },
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
  closeDocument, ensureClosable, forgetTrashedFile, openFileDialog, openPath, save,
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
