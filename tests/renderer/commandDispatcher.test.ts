import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostCommand } from '../../src/shared/ipc.ts'

const exec = vi.fn()
const search = vi.fn()
const hasFocus = vi.fn(() => true)

vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    exec: (...args: unknown[]) => exec(...args),
    search: (...args: unknown[]) => search(...args),
    hasFocus: () => hasFocus(),
  },
}))

// The file operations all end in dialogs or IPC; this test is about routing.
vi.mock('../../src/renderer/services/fileOps.ts', () => ({
  closeDocument: vi.fn(),
  newDocument: vi.fn(),
  openFileDialog: vi.fn(),
  openFolderDialog: vi.fn(),
  exportPdf: vi.fn(),
  revealInFinder: vi.fn(),
  save: vi.fn(),
  saveAs: vi.fn(),
}))

vi.mock('../../src/renderer/api.ts', () => ({
  api: { settings: { patch: vi.fn() } },
  unwrapIpcError: (error: unknown) => String(error),
}))

const { dispatchHostCommand } = await import('../../src/renderer/services/commandDispatcher.ts')

beforeEach(() => {
  exec.mockClear()
  search.mockClear()
  hasFocus.mockReturnValue(true)
})

describe('dispatchHostCommand routing', () => {
  it('sends search commands to search, not to exec', () => {
    for (const [command, name] of [
      ['edit:find', 'find'],
      ['edit:findReplace', 'findReplace'],
      ['edit:findNext', 'findNext'],
      ['edit:findPrevious', 'findPrevious'],
      ['edit:useSelectionForFind', 'useSelectionForFind'],
    ] as [HostCommand, string][]) {
      search.mockClear()
      exec.mockClear()
      dispatchHostCommand(command)
      expect(search, command).toHaveBeenCalledWith(name)
      expect(exec, command).not.toHaveBeenCalled()
    }
  })

  it('keeps undo and redo on the history path', () => {
    // The 'edit:' prefix branch sits below these two literal cases and would
    // swallow them if the order were ever reversed, sending 'undo' into the
    // search table where it does not exist.
    dispatchHostCommand('edit:undo')
    expect(exec).toHaveBeenCalledWith('undo')
    expect(search).not.toHaveBeenCalled()

    exec.mockClear()
    dispatchHostCommand('edit:redo')
    expect(exec).toHaveBeenCalledWith('redo')
    expect(search).not.toHaveBeenCalled()
  })

  it('still routes formatting commands to the editor', () => {
    dispatchHostCommand('format:bold')
    expect(exec).toHaveBeenCalledWith('bold')
    expect(search).not.toHaveBeenCalled()
  })

  it('ignores an edit: command that is not a search command', () => {
    // Nothing emits this today. It is the shape of the next one someone adds
    // (edit:gotoLine, edit:spelling), which must not throw inside the IPC
    // callback.
    expect(() => dispatchHostCommand('edit:gotoLine' as HostCommand)).not.toThrow()
    expect(search).not.toHaveBeenCalled()

    // Prototype keys resolve to real functions on a bare object lookup.
    expect(() => dispatchHostCommand('edit:constructor' as HostCommand)).not.toThrow()
    expect(search).not.toHaveBeenCalled()
  })
})
