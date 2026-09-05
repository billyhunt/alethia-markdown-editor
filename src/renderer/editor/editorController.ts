import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { createEditorState } from './createEditor.ts'

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
        if (update.docChanged) {
          const text = update.state.doc.toString()
          for (const listener of this.docListeners) listener(text)
        }
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
        if (update.docChanged) {
          const next = update.state.doc.toString()
          for (const listener of this.docListeners) listener(next)
        }
      })),
    )
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
