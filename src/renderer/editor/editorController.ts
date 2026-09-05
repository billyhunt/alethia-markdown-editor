import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { createEditorState } from './createEditor.ts'
import { EDITOR_COMMANDS } from './commands.ts'
import type { EditorCommand } from '../../shared/ipc.ts'

/**
 * Owns the single EditorView. React mounts it once and never re-renders it --
 * the document is CodeMirror's state, not React state, so typing never goes
 * through a React render.
 */
class EditorController {
  private view: EditorView | null = null
  private docListeners = new Set<(text: string) => void>()

  mount(parent: HTMLElement): () => void {
    this.view?.destroy()
    this.view = new EditorView({
      state: createEditorState('', EditorView.updateListener.of((update) => {
        if (update.docChanged) this.emit(update.state.doc.toString())
      })),
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
    view.setState(
      createEditorState(text, EditorView.updateListener.of((update) => {
        if (update.docChanged) this.emit(update.state.doc.toString())
      })),
    )
    // Stats and the outline derive from doc changes, so a freshly loaded
    // document must announce itself or the status bar reads zero.
    this.emit(text)
  }

  /** Notifies listeners without an edit, e.g. after loading a document. */
  private emit(text: string): void {
    for (const listener of this.docListeners) listener(text)
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
