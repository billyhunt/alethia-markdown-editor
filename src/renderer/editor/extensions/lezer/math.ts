import { tags } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const DOLLAR = 36
const BACKSLASH = 92
const NEWLINE = 10

/**
 * Adds `$...$` and `$$...$$` to the markdown grammar.
 *
 * The inline rule runs before Escape so a `\$` is still treated as a literal
 * dollar rather than opening a math span.
 */
export const mathExtension: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: tags.special(tags.string) },
    { name: 'BlockMath', block: true },
    { name: 'MathMark', style: tags.processingInstruction },
  ],

  parseInline: [
    {
      name: 'InlineMath',
      before: 'Escape',
      parse(cx, next, pos) {
        // `$$` on its own line is the block form; leave it to the block parser.
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1

        let end = -1
        for (let i = pos + 1; i < cx.end; i += 1) {
          const char = cx.char(i)
          if (char === NEWLINE) break
          if (char === BACKSLASH) {
            i += 1
            continue
          }
          if (char === DOLLAR) {
            end = i
            break
          }
        }
        if (end < 0) return -1

        // Reject `$ x $` and empty spans, matching common markdown-math rules
        // so that prices like "$5 and $6" are not read as math.
        const first = cx.char(pos + 1)
        const last = cx.char(end - 1)
        if (end === pos + 1 || first === 32 || last === 32) return -1

        return cx.addElement(
          cx.elt('InlineMath', pos, end + 1, [
            cx.elt('MathMark', pos, pos + 1),
            cx.elt('MathMark', end, end + 1),
          ]),
        )
      },
    },
  ],

  parseBlock: [
    {
      name: 'BlockMath',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (line.text.trim() !== '$$') return false
        const start = cx.lineStart

        while (cx.nextLine()) {
          if (line.text.trim() === '$$') {
            const end = cx.lineStart + line.text.length
            cx.addElement(cx.elt('BlockMath', start, end))
            cx.nextLine()
            return true
          }
        }
        // Unclosed: treat the rest of the document as math rather than failing.
        cx.addElement(cx.elt('BlockMath', start, cx.lineStart))
        return true
      },
    },
  ],
}
