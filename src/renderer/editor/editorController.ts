import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { createEditorState } from './createEditor.ts'
import { EDITOR_COMMANDS } from './commands.ts'
import { SEARCH_COMMANDS, searchFocusPlan } from './searchCommands.ts'
import { focusMode, modesCompartment, typewriterMode } from './extensions/modes.ts'
import { documentPath, documentPathCompartment } from './extensions/documentPath.ts'
import { forgetImageFailures } from './widgets/ImageWidget.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import type { EditorCommand, SearchCommand } from '../../shared/ipc.ts'

/**
 * Owns the single EditorView. React mounts it once and never re-renders it --
 * the document is CodeMirror's state, not React state, so typing never goes
 * through a React render.
 */
class EditorController {
  private view: EditorView | null = null
  private docListeners = new Set<(text: string) => void>()
  /** Kept so a rebuilt state (setDocument) starts with the right path. */
  private filePath: string | null = null


  mount(parent: HTMLElement): () => void {
    this.view?.destroy()
    this.view = new EditorView({
      state: createEditorState(
        '',
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.emit(update.state.doc.toString())
        }),
        // A remount must not forget where the document lives, or every image
        // becomes a "save the document" placeholder until the path changes.
        { filePath: this.filePath },
      ),
      parent,
    })
    return () => {
      this.view?.destroy()
      this.view = null
    }
  }

  /**
   * Replaces the whole document with a fresh state, which intentionally resets
   * undo history -- undoing past a file open into the previous file's content
   * would be surprising.
   */
  setDocument(text: string): void {
    const view = this.view
    if (!view) return
    // A fresh document is a fresh start for images too: a file that was
    // missing last time may exist now, and reopening is how a user retries.
    forgetImageFailures()
    view.setState(
      createEditorState(
        text,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) this.emit(update.state.doc.toString())
        }),
        { filePath: this.filePath },
      ),
    )
    // Stats and the outline derive from doc changes, so a freshly loaded
    // document must announce itself or the status bar reads zero.
    this.emit(text)
  }

  /** Notifies listeners without an edit, e.g. after loading a document. */
  private emit(text: string): void {
    // This state is read by close/replace/quit handlers, so it must follow
    // every editor transaction synchronously rather than through a UI timer.
    useDocumentStore.getState().setDirty(text !== useDocumentStore.getState().savedText)
    for (const listener of this.docListeners) listener(text)
  }

  /**
   * Replaces the whole document as a normal edit, so it joins the undo
   * history -- unlike setDocument, which builds a fresh state and discards it.
   */
  replaceAll(text: string): void {
    const view = this.view
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      userEvent: 'input.restore',
    })
    view.focus()
  }



  getText(): string {
    return this.view?.state.doc.toString() ?? ''
  }

  focus(): void {
    this.view?.focus()
  }

  scrollToPos(pos: number): void {
    const view = this.view
    if (!view) return
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 48 }),
    })
    view.focus()
  }


  /** Runs a formatting or history command; a no-op when nothing is mounted. */
  exec(command: EditorCommand): boolean {
    const view = this.view
    if (!view) return false
    view.focus()
    return EDITOR_COMMANDS[command]({ state: view.state, dispatch: view.dispatch })
  }

  /**
   * Tells the editor where the document lives, so relative image sources can
   * resolve. Driven from the document store rather than passed to
   * setDocument, because the path becomes known in a different place from the
   * text (a new document gets a path only after Save As).
   */
  setFilePath(filePath: string | null): void {
    this.filePath = filePath
    const view = this.view
    if (!view || view.state.facet(documentPath) === filePath) return
    forgetImageFailures()
    view.dispatch({
      effects: documentPathCompartment.reconfigure(documentPath.of(filePath)),
    })
  }

  /**
   * Runs a search command from the menu. Focus is only taken when it is not
   * already inside the editor (which includes the search panel's own fields)
   * and not in some other field that is being typed into; see
   * `searchFocusPlan`.
   */
  search(command: SearchCommand): boolean {
    const view = this.view
    if (!view) return false

    const plan = searchFocusPlan(view, document.activeElement)
    if (plan === 'ignore') return false
    if (plan === 'take-focus') view.focus()
    return SEARCH_COMMANDS[command](view)
  }

  /** Swaps focus/typewriter modes without rebuilding the document state. */
  setModes(modes: { focus: boolean; typewriter: boolean }): void {
    const view = this.view
    if (!view) return
    view.dispatch({
      effects: modesCompartment.reconfigure([
        modes.focus ? focusMode() : [],
        modes.typewriter ? typewriterMode() : [],
      ]),
    })
  }

  hasFocus(): boolean {
    return this.view?.hasFocus ?? false
  }

  /** Current state, for callers that need to derive stats or an outline. */
  getState() {
    return this.view?.state ?? null
  }

  setCursor(pos: number): void {
    const view = this.view
    if (!view) return
    view.focus()
    view.dispatch({ selection: EditorSelection.cursor(pos) })
  }

  onDocChange(listener: (text: string) => void): () => void {
    this.docListeners.add(listener)
    return () => this.docListeners.delete(listener)
  }
}

export const editorController = new EditorController()
