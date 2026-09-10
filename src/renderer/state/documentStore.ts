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
   * The file name the title last produced, which is not always the name on
   * disk: a taken name gets numbered. Comparing the next title against this
   * rather than against the file's basename is what keeps a numbered
   * document from trying, and failing, to rename itself on every save.
   */
  autoNameBase: string | null
  /**
   * This buffer may be filed automatically once it has a title. True only for
   * a document that started empty: a buffer that arrived with content it did
   * not ask for -- the welcome tour, edits rescued from a trashed file -- is
   * not something to write into the user's folder behind their back.
   */
  autoNameable: boolean
  /**
   * Bumped whenever a different document takes over the editor. Work started
   * against one document and finished after an await checks this before
   * writing anything back, so a save in flight cannot attach itself to
   * whatever the user opened in the meantime.
   */
  revision: number

  load: (doc: {
    filePath: string | null
    text: string
    mtimeMs: number | null
    lineEnding?: LineEnding
    namedByTitle?: boolean
    autoNameBase?: string | null
    /** Defaults to true for an empty untitled buffer. */
    autoNameable?: boolean
  }) => void
  markSaved: (saved: {
    filePath: string
    text: string
    mtimeMs: number
    /** Left alone when omitted, so a plain save does not change ownership. */
    namedByTitle?: boolean
    autoNameBase?: string | null
  }) => void
  /** The file moved. Its content, and therefore its dirty state, did not. */
  setPath: (
    filePath: string,
    naming: { namedByTitle: boolean; autoNameBase?: string | null },
  ) => void
  /**
   * Records the name the title produced even when the rename was refused, so
   * a name that can never be taken is not attempted again and again.
   */
  setAutoNameBase: (autoNameBase: string | null) => void
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
  autoNameBase: null,
  autoNameable: true,
  revision: 0,

  load: ({ filePath, text, mtimeMs, lineEnding, namedByTitle, autoNameBase, autoNameable }) =>
    set((state) => ({
      filePath,
      savedText: text,
      mtimeMs,
      lineEnding: lineEnding ?? '\n',
      dirty: false,
      namedByTitle: namedByTitle ?? false,
      // A reload keeps the naming it had; a different document starts over.
      autoNameBase: autoNameBase ?? (namedByTitle ? state.autoNameBase : null),
      autoNameable: autoNameable ?? (filePath === null && text === ''),
      revision: state.revision + 1,
    })),
  markSaved: ({ filePath, text, mtimeMs, namedByTitle, autoNameBase }) =>
    set((state) => ({
      filePath,
      savedText: text,
      mtimeMs,
      dirty: false,
      namedByTitle: namedByTitle ?? state.namedByTitle,
      autoNameBase: autoNameBase ?? state.autoNameBase,
    })),
  setPath: (filePath, { namedByTitle, autoNameBase }) =>
    set((state) => ({
      filePath,
      namedByTitle,
      autoNameBase: namedByTitle ? (autoNameBase ?? state.autoNameBase) : null,
    })),
  setAutoNameBase: (autoNameBase) => set({ autoNameBase }),
  setDirty: (dirty) => set({ dirty }),
  syncMtime: (mtimeMs) => set({ mtimeMs }),
}))

export const documentName = (filePath: string | null): string =>
  filePath ? (filePath.split('/').pop() ?? 'Untitled') : 'Untitled'
