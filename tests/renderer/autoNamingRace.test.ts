import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'

// The real autosave hook driving the real file operations, with only the
// host (main process) and the editor replaced. The unit tests for each half
// pass their own mocks; what they cannot show is the two cooperating while the
// user keeps typing.

const host = vi.hoisted(() => ({
  dialog: { saveAs: vi.fn(), showError: vi.fn() },
  fs: { createFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), readFile: vi.fn() },
  folder: { list: vi.fn() },
  document: { watch: vi.fn(), unwatch: vi.fn() },
  recents: { add: vi.fn(), addFolder: vi.fn(), listFolders: vi.fn() },
}))
vi.mock('../../src/renderer/api.ts', () => ({ api: host, unwrapIpcError: String }))

const buffer = vi.hoisted(() => ({ text: '' }))
const listeners = vi.hoisted(() => new Set<(text: string) => void>())
vi.mock('../../src/renderer/editor/editorController.ts', () => ({
  editorController: {
    getText: () => buffer.text,
    setDocument: (text: string) => { buffer.text = text },
    onDocChange: (listener: (text: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  },
}))

// The hook is one useEffect with no render output; run its body directly.
const effects = vi.hoisted(() => [] as Array<() => (() => void) | void>)
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useEffect: (fn: () => (() => void) | void) => {
    effects.push(fn)
  },
}))

import { useAutosave } from '../../src/renderer/hooks/useAutosave.ts'
import { useDocumentStore as docs } from '../../src/renderer/state/documentStore.ts'
import { useWorkspaceStore as workspace } from '../../src/renderer/state/workspaceStore.ts'

let cleanup: (() => void) | void

/** What the user does: the buffer changes and the editor says so. */
const type = (text: string) => {
  buffer.text = text
  docs.getState().setDirty(text !== docs.getState().savedText)
  for (const listener of listeners) listener(text)
}

/** A disk the test can stall, holding every file name that exists. */
function fakeDisk(files: Record<string, string>) {
  const gate = { release: undefined as (() => void) | undefined, stall: false }
  host.fs.rename.mockImplementation(async (from: string, name: string) => {
    if (gate.stall) await new Promise<void>((resolve) => { gate.release = resolve })
    const to = `/notes/${name}`
    files[to] = files[from]
    delete files[from]
    return { path: to }
  })
  host.fs.writeFile.mockImplementation(async (path: string, text: string) => {
    files[path] = text
    return { ok: true, mtimeMs: 20 }
  })
  host.fs.createFile.mockImplementation(async ({ name, content }: { name: string; content: string }) => {
    files[`/notes/${name}`] = content
    return { path: `/notes/${name}`, mtimeMs: 10 }
  })
  return { files, gate }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  listeners.clear()
  buffer.text = ''
  docs.getState().load({ filePath: null, text: '', mtimeMs: null })
  workspace.setState({ folderRoot: '/notes', tree: null, notice: null, autosave: true })
  host.folder.list.mockResolvedValue({ root: '/notes', tree: null, truncated: false })
  host.document.watch.mockResolvedValue('doc-1')
  host.recents.add.mockResolvedValue(undefined)
  effects.length = 0
  useAutosave()
  cleanup = effects[0]?.()
})

afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})

describe('automatic naming while the user keeps typing', () => {
  it('files a new document, then follows its title as it is finished', async () => {
    const { files } = fakeDisk({})
    type('# Weekly\n')
    await vi.advanceTimersByTimeAsync(2000)
    expect(Object.keys(files)).toEqual(['/notes/Weekly.md'])

    type('# Weekly review\n\nbody\n')
    await vi.advanceTimersByTimeAsync(2000)
    // One file, under the new name, holding the new text.
    expect(files).toEqual({ '/notes/Weekly review.md': '# Weekly review\n\nbody\n' })
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Weekly review.md',
      dirty: false,
      namedByTitle: true,
    })
  })

  it('does not strand an intermediate name when the title changes during a rename', async () => {
    const { files, gate } = fakeDisk({})
    type('# Weekly\n')
    await vi.advanceTimersByTimeAsync(2000)
    expect(Object.keys(files)).toEqual(['/notes/Weekly.md'])

    // The title changes, and while the filesystem is renaming for it, the
    // user finishes the title. The save that follows the first rename writes
    // the finished text and leaves the document clean.
    gate.stall = true
    type('# Weekly rev\n')
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.fs.rename).toHaveBeenLastCalledWith('/notes/Weekly.md', 'Weekly rev.md')

    type('# Weekly review\n')
    gate.stall = false
    gate.release?.()
    await vi.advanceTimersByTimeAsync(0)

    // Both passes have to land: the file ends on the finished title, with
    // nothing left behind under the name in between.
    await vi.advanceTimersByTimeAsync(6000)
    expect(Object.keys(files)).toEqual(['/notes/Weekly review.md'])
    expect(files['/notes/Weekly review.md']).toBe('# Weekly review\n')
    expect(docs.getState()).toMatchObject({
      filePath: '/notes/Weekly review.md',
      dirty: false,
    })
  })

  it('keeps trying to file a document the disk refused at first', async () => {
    const { files } = fakeDisk({})
    host.fs.createFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    )
    host.fs.createFile.mockImplementationOnce(async ({ name, content }: { name: string; content: string }) => {
      files[`/notes/${name}`] = content
      return { path: `/notes/${name}`, mtimeMs: 10 }
    })

    type('# Notes\n')
    await vi.advanceTimersByTimeAsync(2000)
    // The failure is visible at once...
    expect(workspace.getState().notice?.message).toMatch(/could not be saved automatically/)
    expect(docs.getState().filePath).toBeNull()

    // ...and the next pass, with no further typing, files it and clears it.
    await vi.advanceTimersByTimeAsync(2000)
    expect(files).toEqual({ '/notes/Notes.md': '# Notes\n' })
    expect(docs.getState().filePath).toBe('/notes/Notes.md')
    expect(workspace.getState().notice).toBeNull()
  })
})
