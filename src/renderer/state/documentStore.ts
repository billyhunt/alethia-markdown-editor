import { create } from 'zustand'
import type { LineEnding } from '../../shared/api'

export interface DocumentState {
  /** Absolute path, or null for a document that has never been saved. */
  filePath: string | null
  /** The text as last read from or written to disk. */
  savedText: string
  /** mtime of the last read/write; null for an unsaved document. */
  mtimeMs: number | null
  /** Preserved from the file so saving does not rewrite every line. */
  lineEnding: LineEnding
  dirty: boolean
  /**
   * The path was chosen for the user from the document's title, and no one
   * has since picked a name themselves. While this holds, the file keeps
   * following the title.
   */
  namedByTitle: boolean
  /**
   * This buffer may be filed automatically once it has a title. True only for
   * a document that started empty: a buffer that arrived with content it did
   * not ask for -- the welcome tour, edits rescued from a trashed file -- is
   * not something to write into the user's folder behind their back.
   */
  autoNameable: boolean

  load: (doc: {
    filePath: string | null
    text: string
    mtimeMs: number | null
    lineEnding?: LineEnding
    namedByTitle?: boolean
    /** Defaults to true for an empty untitled buffer. */
    autoNameable?: boolean
  }) => void
  markSaved: (saved: {
    filePath: string
    text: string
    mtimeMs: number
    /** Left alone when omitted, so a plain save does not change ownership. */
    namedByTitle?: boolean
  }) => void
  /** The file moved. Its content, and therefore its dirty state, did not. */
  setPath: (filePath: string, namedByTitle: boolean) => void
  setDirty: (dirty: boolean) => void
  /** Refreshes mtime after the user chooses to keep their version of a file. */
  syncMtime: (mtimeMs: number | null) => void
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  savedText: '',
  mtimeMs: null,
  lineEnding: '\n',
  dirty: false,
  namedByTitle: false,
  autoNameable: true,

  load: ({ filePath, text, mtimeMs, lineEnding, namedByTitle, autoNameable }) =>
    set({
      filePath,
      savedText: text,
      mtimeMs,
      lineEnding: lineEnding ?? '\n',
      dirty: false,
      namedByTitle: namedByTitle ?? false,
      autoNameable: autoNameable ?? (filePath === null && text === ''),
    }),
  markSaved: ({ filePath, text, mtimeMs, namedByTitle }) =>
    set((state) => ({
      filePath,
      savedText: text,
      mtimeMs,
      dirty: false,
      namedByTitle: namedByTitle ?? state.namedByTitle,
    })),
  setPath: (filePath, namedByTitle) => set({ filePath, namedByTitle }),
  setDirty: (dirty) => set({ dirty }),
  syncMtime: (mtimeMs) => set({ mtimeMs }),
}))

export const documentName = (filePath: string | null): string =>
  filePath ? (filePath.split('/').pop() ?? 'Untitled') : 'Untitled'
