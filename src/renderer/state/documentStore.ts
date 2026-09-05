import { create } from 'zustand'

export interface DocumentState {
  /** Absolute path, or null for a document that has never been saved. */
  filePath: string | null
  /** The text as last read from or written to disk. */
  savedText: string
  /** mtime of the last read/write; null for an unsaved document. */
  mtimeMs: number | null
  dirty: boolean

  load: (doc: { filePath: string | null; text: string; mtimeMs: number | null }) => void
  markSaved: (saved: { filePath: string; text: string; mtimeMs: number }) => void
  setDirty: (dirty: boolean) => void
  /** Refreshes mtime after the user chooses to keep their version of a file. */
  syncMtime: (mtimeMs: number | null) => void
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  savedText: '',
  mtimeMs: null,
  dirty: false,

  load: ({ filePath, text, mtimeMs }) =>
    set({ filePath, savedText: text, mtimeMs, dirty: false }),
  markSaved: ({ filePath, text, mtimeMs }) =>
    set({ filePath, savedText: text, mtimeMs, dirty: false }),
  setDirty: (dirty) => set({ dirty }),
  syncMtime: (mtimeMs) => set({ mtimeMs }),
}))

export const documentName = (filePath: string | null): string =>
  filePath ? (filePath.split('/').pop() ?? 'Untitled') : 'Untitled'
