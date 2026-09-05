import { tags } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

/**
 * YAML front matter, but only at the very start of the document -- otherwise
 * a `---` mid-file is a horizontal rule, not metadata.
 */
export const frontMatterExtension: MarkdownConfig = {
  defineNodes: [{ name: 'FrontMatter', block: true, style: tags.meta }],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text.trim() !== '---') return false
        const start = cx.lineStart
        while (cx.nextLine()) {
          if (line.text.trim() === '---') {
            const end = cx.lineStart + line.text.length
            cx.addElement(cx.elt('FrontMatter', start, end))
            cx.nextLine()
            return true
          }
        }
        return false
      },
    },
  ],
}
