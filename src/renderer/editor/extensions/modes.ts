import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { Compartment, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

/** Modes are swapped in and out without rebuilding the editor state. */
export const modesCompartment = new Compartment()

/** The top-level block containing `pos`, i.e. the child of the document root. */
function topLevelBlock(state: EditorView['state'], pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1)
  let candidate: SyntaxNode | null = null
  while (node) {
    if (node.parent && node.parent.name === 'Document') candidate = node
    node = node.parent
  }
  return candidate
}

const dim = Decoration.line({ class: 'cm-focus-dim' })

/**
 * Focus mode: everything outside the paragraph holding the caret is dimmed.
 */
const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const { state } = view
      const head = state.selection.main.head
      const block = topLevelBlock(state, head)
      const from = block?.from ?? head
      const to = block?.to ?? head

      const ranges = []
      for (const range of view.visibleRanges) {
        let pos = range.from
        while (pos <= range.to) {
          const line = state.doc.lineAt(pos)
          if (line.to < from || line.from > to) ranges.push(dim.range(line.from))
          pos = line.to + 1
        }
      }
      return Decoration.set(ranges, true)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

export const focusMode = (): Extension => focusPlugin

/**
 * Typewriter mode: the caret line stays vertically centred.
 *
 * The scroll is deferred to an animation frame because dispatching from inside
 * an update listener is not allowed.
 */
export const typewriterMode = (): Extension => [
  EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return
    requestAnimationFrame(() => {
      const head = update.view.state.selection.main.head
      update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
    })
  }),
  // Padding so the first and last lines can actually reach the centre.
  EditorView.theme({ '.cm-content': { paddingTop: '45vh', paddingBottom: '45vh' } }),
]
