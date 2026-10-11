import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { EditorView } from '@codemirror/view'
import { htmlToMarkdown } from '../htmlToMarkdown.ts'

/** Places where markdown means nothing, so a paste must stay verbatim. */
const VERBATIM = new Set([
  'FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'InlineMath', 'BlockMath', 'FrontMatter',
  'HTMLBlock', 'CommentBlock',
  // A table cell holds one line; a converted paste would be a whole block.
  'Table',
])

function inVerbatim(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (VERBATIM.has(node.name)) return true
  }
  return false
}

/**
 * Pasting rich text inserts it as markdown. Paste and Match Style
 * (Shift+Cmd+V) still pastes plain text: the clipboard it hands over has no
 * HTML.
 */
export const pasteMarkdown = EditorView.domEventHandlers({
  paste(event, view) {
    const html = event.clipboardData?.getData('text/html')
    if (!html) return false
    const { from } = view.state.selection.main
    if (inVerbatim(view.state, from)) return false
    const markdown = htmlToMarkdown(html)
    if (markdown === null) return false

    event.preventDefault()
    view.dispatch({
      ...view.state.replaceSelection(markdown),
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    return true
  },
})
