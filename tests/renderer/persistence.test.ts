import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const host = vi.hoisted(() => ({
  dialog: { confirmSaveChanges: vi.fn(), showError: vi.fn() },
  fs: { writeFile: vi.fn(), rename: vi.fn() },
  document: { watch: vi.fn(), unwatch: vi.fn() },
  recents: { add: vi.fn() },
}))
vi.mock('../../src/renderer/api.ts', () => ({ api: host, unwrapIpcError: String }))
import { editorController as editor } from '../../src/renderer/editor/editorController.ts'
import { useDocumentStore as docs } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'
import { ensureClosable, renameFile, save } from '../../src/renderer/services/fileOps.ts'
import { handleFileChange } from '../../src/renderer/services/externalChanges.ts'
import { useAutosave } from '../../src/renderer/hooks/useAutosave.ts'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

let unmount: () => void
let root: Root
const file = '/test/note.md'
function Autosave() { useAutosave(); return null }

beforeEach(async () => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  document.body.innerHTML = '<div id="editor"></div><div id="react"></div>'
  unmount = editor.mount(document.querySelector('#editor')!)
  editor.setDocument('saved')
  docs.getState().load({ filePath: file, text: 'saved', mtimeMs: 1, lineEnding: '\r\n' })
  workspace.setState({ autosave: true, folderRoot: null, notice: null })
  host.fs.writeFile.mockResolvedValue({ ok: true, mtimeMs: 2 })
  host.dialog.confirmSaveChanges.mockResolvedValue('cancel')
  root = createRoot(document.querySelector('#react')!)
  await act(async () => root.render(createElement(Autosave)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  unmount()
  vi.useRealTimers()
})

describe('document persistence', () => {
  it('prompts on close in the same tick as typing and clears dirty on undo', async () => {
    editor.replaceAll('saved!')
    expect(docs.getState().dirty).toBe(true)
    expect(await ensureClosable()).toBe(false)
    expect(host.dialog.confirmSaveChanges).toHaveBeenCalledOnce()
    editor.exec('undo')
    expect(editor.getText()).toBe('saved')
    expect(docs.getState().dirty).toBe(false)
  })

  it('keeps newer typing dirty when a delayed save finishes and refuses closure', async () => {
    let finish!: (value: { ok: true; mtimeMs: number }) => void
    host.fs.writeFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    editor.replaceAll('first edit')
    docs.getState().setDirty(true)
    const saving = save()
    editor.replaceAll('second edit')
    finish({ ok: true, mtimeMs: 2 })
    expect(await saving).toBe(true)
    expect(docs.getState()).toMatchObject({ savedText: 'first edit', dirty: true })
    expect(editor.getText()).toBe('second edit')
    expect(await ensureClosable()).toBe(false)
  })

  it('re-arms autosave when an edit timer expires during the previous write', async () => {
    let finish!: (value: { ok: true; mtimeMs: number }) => void
    host.fs.writeFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    editor.replaceAll('first edit')
    docs.getState().setDirty(true)
    await vi.advanceTimersByTimeAsync(2000)
    editor.replaceAll('second edit')
    await vi.advanceTimersByTimeAsync(2000)
    finish({ ok: true, mtimeMs: 2 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.fs.writeFile).toHaveBeenCalledTimes(2)
    expect(host.fs.writeFile.mock.calls[1][1]).toBe('second edit')
    expect(docs.getState()).toMatchObject({ savedText: 'second edit', dirty: false })
  })

  it('coalesces Cmd+S with an autosave already writing the same document', async () => {
    let finish!: (value: { ok: true; mtimeMs: number }) => void
    host.fs.writeFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    editor.replaceAll('shared final text')
    await vi.advanceTimersByTimeAsync(2000)
    const manualSave = save()
    await vi.waitFor(() => expect(host.fs.writeFile).toHaveBeenCalledOnce())
    finish({ ok: true, mtimeMs: 2 })
    expect(await manualSave).toBe(true)
    expect(host.fs.writeFile).toHaveBeenCalledOnce()
    expect(host.fs.writeFile.mock.calls[0][1]).toBe('shared final text')
    expect(docs.getState()).toMatchObject({ savedText: 'shared final text', dirty: false })
  })

  it('does not apply a late save to a replacement document', async () => {
    let finish!: (value: { ok: true; mtimeMs: number }) => void
    host.fs.writeFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    editor.replaceAll('first edit')
    const saving = save()
    editor.setDocument('other')
    docs.getState().load({ filePath: '/test/other.md', text: 'other', mtimeMs: 3 })
    finish({ ok: true, mtimeMs: 2 })
    await saving
    expect(docs.getState()).toMatchObject({ filePath: '/test/other.md', savedText: 'other' })
  })

  it('treats Keep mine as an explicit overwrite accepted as the new baseline', async () => {
    editor.replaceAll('my unsaved edit')
    await handleFileChange({ path: file, kind: 'changed', mtimeMs: 2 })
    const keepMine = workspace.getState().notice!.actions.find(action => action.label === 'Keep mine')!
    keepMine.run()
    await vi.waitFor(() => expect(docs.getState()).toMatchObject({
      savedText: 'my unsaved edit', dirty: false,
    }))
    expect(host.fs.writeFile).toHaveBeenCalledWith(file, 'my unsaved edit', {
      force: true, lineEnding: '\r\n',
    })
  })

  it('preserves edits and line endings when the open file is renamed', async () => {
    host.fs.rename.mockResolvedValue({ path: '/test/renamed.md' })
    editor.replaceAll('unsaved edit')
    docs.getState().setDirty(true)
    await renameFile(file, 'renamed.md')
    expect(editor.getText()).toBe('unsaved edit')
    expect(docs.getState()).toMatchObject({
      filePath: '/test/renamed.md', savedText: 'saved', dirty: true, lineEnding: '\r\n',
    })
  })

  it('shows where version history remains when it could not be moved', async () => {
    host.fs.rename.mockResolvedValue({ path: '/test/renamed.md', historyPath: file })
    await renameFile(file, 'renamed.md')
    expect(workspace.getState().notice?.message).toContain(file)
    expect(workspace.getState().notice?.message).toContain('history could not be moved')
  })
})
