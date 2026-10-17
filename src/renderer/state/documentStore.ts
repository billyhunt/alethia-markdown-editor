import { create } from 'zustand'
import type { LineEnding } from '../../shared/api'

export interface DocumentState {
  /** Absolute path, or null for a document that has never been saved. */
  filePath: string | null
  documentId: string | null
  /** Bumped whenever another document takes over this window. */
  revision: number
  /** The text as last read from or written to disk. */
  savedText: string
  /** mtime of the last read/write; null for an unsaved document. */
  mtimeMs: number | null
  /** Preserved from the file so saving does not rewrite every line. */
  lineEnding: LineEnding
  dirty: boolean

  load: (doc: {
    filePath: string | null
    documentId?: string | null
    text: string
    mtimeMs: number | null
    lineEnding?: LineEnding
  }) => void
  markSaved: (saved: { filePath: string; text: string; mtimeMs: number }) => void
  setDirty: (dirty: boolean) => void
  /** Refreshes mtime after the user chooses to keep their version of a file. */
  syncMtime: (mtimeMs: number | null) => void
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  documentId: null,
  revision: 0,
  savedText: '',
  mtimeMs: null,
  lineEnding: '\n',
  dirty: false,

  load: ({ filePath, documentId, text, mtimeMs, lineEnding }) =>
    set((state) => ({
      filePath,
      documentId:
        documentId === undefined
          ? state.filePath === filePath ? state.documentId : null
          : documentId,
      revision: state.revision + 1,
      savedText: text,
      mtimeMs,
      lineEnding: lineEnding ?? '\n',
      dirty: false,
    })),
  // Main resolves relative links against the path behind documentId, so an id
  // must never outlive a change of path (Save As) while its re-watch is pending.
  markSaved: ({ filePath, text, mtimeMs }) =>
    set((state) => ({
      filePath,
      documentId: state.filePath === filePath ? state.documentId : null,
      savedText: text,
      mtimeMs,
      dirty: false,
    })),
  setDirty: (dirty) => set({ dirty }),
  syncMtime: (mtimeMs) => set({ mtimeMs }),
}))

export const documentName = (filePath: string | null): string =>
  filePath ? (filePath.split('/').pop() ?? 'Untitled') : 'Untitled'
