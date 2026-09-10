import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ops = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  saveNewByTitle: vi.fn(async () => true),
  syncAutoName: vi.fn(async () => undefined),
}))
vi.mock('../../src/renderer/services/fileOps.ts', () => ops)

// The hook is one useEffect with no render output, so its effect body is
// captured and run directly rather than by mounting a React tree.
const effects = vi.hoisted(() => [] as Array<() => (() => void) | void>)
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (fn: () => (() => void) | void) => {
    effects.push(fn)
  },
}))

const listeners = vi.hoisted(() => new Set<(text: string) => void>())
vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    onDocChange: (listener: (text: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  },
}))

import { useAutosave } from '../../src/renderer/hooks/useAutosave.ts'
import { useDocumentStore as docs } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'

let cleanup: (() => void) | void
/** Stands in for the component that would normally hold the hook. */
function AutosaveHost(): null {
  useAutosave()
  return null
}

// The react mock above captures the effect body instead of scheduling it,
// so the test runs it directly and keeps its teardown.
function startAutosave(): void {
  effects.length = 0
  AutosaveHost()
  cleanup = effects[0]?.()
}

const type = (text = '# Draft\n') => {
  for (const listener of listeners) listener(text)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  listeners.clear()
  docs.getState().load({ filePath: null, text: '', mtimeMs: null })
  workspace.setState({ autosave: true })
  startAutosave()
})

afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})

describe('autosave', () => {
  it('files an untitled buffer rather than leaving it unsaved', async () => {
    docs.getState().setDirty(true)
    type()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.saveNewByTitle).toHaveBeenCalledOnce()
    expect(ops.save).not.toHaveBeenCalled()
  })

  it('renames before writing, so the save lands on the current name', async () => {
    const order: string[] = []
    ops.syncAutoName.mockImplementation(async () => {
      order.push('rename')
    })
    ops.save.mockImplementation(async () => {
      order.push('save')
      return true
    })
    docs.getState().load({
      filePath: '/notes/Draft.md', text: '# Draft\n', mtimeMs: 1, namedByTitle: true,
    })
    docs.getState().setDirty(true)
    type()
    await vi.advanceTimersByTimeAsync(2000)
    expect(order).toEqual(['rename', 'save'])
  })

  it('does not rename a document the user named themselves', async () => {
    docs.getState().load({ filePath: '/notes/Chosen.md', text: 'x', mtimeMs: 1 })
    docs.getState().setDirty(true)
    type()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.syncAutoName).not.toHaveBeenCalled()
    expect(ops.save).toHaveBeenCalledOnce()
  })

  it('waits for typing to settle', async () => {
    docs.getState().setDirty(true)
    type()
    await vi.advanceTimersByTimeAsync(1500)
    type()
    await vi.advanceTimersByTimeAsync(1500)
    expect(ops.saveNewByTitle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(ops.saveNewByTitle).toHaveBeenCalledOnce()
  })

  it('leaves a clean document, and a switched-off autosave, alone', async () => {
    type()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.saveNewByTitle).not.toHaveBeenCalled()

    workspace.setState({ autosave: false })
    docs.getState().setDirty(true)
    type()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.saveNewByTitle).not.toHaveBeenCalled()
  })

  it('comes back rather than dropping a pass while a save is in flight', async () => {
    let release: (() => void) | undefined
    ops.saveNewByTitle.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { release = () => resolve(true) }),
    )
    docs.getState().setDirty(true)
    type()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.saveNewByTitle).toHaveBeenCalledOnce()

    // Edits made during the slow save must not be lost to a skipped pass.
    type('# Draft more\n')
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.saveNewByTitle).toHaveBeenCalledOnce()
    release?.()
    await vi.advanceTimersByTimeAsync(2000)
    expect(ops.saveNewByTitle).toHaveBeenCalledTimes(2)
  })
})
