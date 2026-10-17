import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { EditorView } from '@codemirror/view'
import { fitToLine, htmlToMarkdown } from '../htmlToMarkdown.ts'

/** Places where markdown means nothing, so a paste must stay verbatim. */
const VERBATIM = new Set([
  'FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'InlineMath', 'BlockMath', 'FrontMatter',
  'HTMLBlock', 'CommentBlock',
  // A table cell holds one line; a converted paste would be a whole block.
  'Table',
])

/** Inline spans end at their closing mark: a caret just after one is outside. */
const INLINE = new Set(['InlineCode', 'InlineMath'])

function inVerbatim(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (VERBATIM.has(node.name) && !(INLINE.has(node.name) && node.to === pos)) return true
  }
  return false
}

/**
 * Pasting rich text inserts it as markdown. Paste and Match Style
 * (Shift+Cmd+V) still pastes plain text: the clipboard it hands over has no
 * HTML.
 *
 * Every selection range decides for itself: with several carets (Alt-click,
 * a rectangular selection) the ones inside code get the clipboard's plain
 * text and the rest get the converted markdown, all in one transaction.
 */
export const pasteMarkdown = EditorView.domEventHandlers({
  paste(event, view) {
    const html = event.clipboardData?.getData('text/html')
    if (!html) return false
    const { state } = view
    const verbatim = state.selection.ranges.map((range) => inVerbatim(state, range.from))
    const text = event.clipboardData?.getData('text/plain') ?? ''
    // The editor's own paste handles plain text, including one line per caret.
    if (verbatim.every(Boolean) || (verbatim.some(Boolean) && !text)) return false
    const markdown = htmlToMarkdown(html)
    if (markdown === null) return false

    event.preventDefault()
    let index = 0
    view.dispatch({
      ...state.changeByRange((range) => {
        const insert = state.toText(
          verbatim[index++]
            ? text
            : fitToLine(markdown, state.sliceDoc(state.doc.lineAt(range.from).from, range.from), state.sliceDoc(range.to, state.doc.lineAt(range.to).to)),
        )
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        }
      }),
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    return true
  },
})
