import { parser } from '@lezer/markdown'

/**
 * Renders a small subset of inline markdown to DOM, for text inside a rendered
 * table cell. Deliberately minimal: block constructs and raw HTML are emitted
 * as plain text rather than interpreted.
 */
const TAGS: Record<string, string> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  InlineCode: 'code',
  Strikethrough: 'del',
}

const MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark'])

export function renderInlineMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const tree = parser.parse(source)

  // Stack of open elements; text is appended to whatever is on top.
  const stack: Array<{ node: Node; to: number }> = [{ node: fragment, to: source.length }]
  let cursor = 0

  const flushText = (upto: number) => {
    if (upto > cursor) {
      stack[stack.length - 1].node.appendChild(document.createTextNode(source.slice(cursor, upto)))
      cursor = upto
    }
  }

  tree.iterate({
    enter: (ref) => {
      while (stack.length > 1 && ref.from >= stack[stack.length - 1].to) {
        flushText(stack[stack.length - 1].to)
        stack.pop()
      }

      if (MARKS.has(ref.name)) {
        // Delimiters are structure, not content.
        flushText(ref.from)
        cursor = ref.to
        return false
      }

      const tag = TAGS[ref.name]
      if (tag) {
        flushText(ref.from)
        const element = document.createElement(tag)
        stack[stack.length - 1].node.appendChild(element)
        stack.push({ node: element, to: ref.to })
      }
      return true
    },
  })

  while (stack.length > 1) {
    flushText(stack[stack.length - 1].to)
    stack.pop()
  }
  flushText(source.length)
  return fragment
}
