import TurndownService from 'turndown'

/**
 * Clipboard HTML past this many characters is left to the plain-text paste:
 * the conversion is synchronous, and a page-sized copy would freeze the editor
 * for text nobody wanted converted.
 */
export const MAX_HTML_LENGTH = 1_000_000

/**
 * Stands in for the end of every blank line inside a code block while the
 * document is assembled, so tidying blank lines between blocks cannot tell code
 * from prose by guessing at the fence. Private-use, and stripped from the input.
 */
const BLANK_CODE_LINE = '\uE000'

/**
 * Converts clipboard HTML to markdown, so text copied from a web page or a
 * document keeps its headings, links, lists, emphasis and tables.
 *
 * Returns null when the HTML carries no structure worth keeping -- code
 * editors and terminals put plain text on the clipboard wrapped in styled
 * spans or a bare <pre>, and converting that would only add backslash
 * escapes to code.
 *
 * A copy of part of a line (a word, a phrase) keeps a space at either end if
 * the selection had one, since the words around it are in the document.
 */
export function htmlToMarkdown(html: string): string | null {
  if (html.length > MAX_HTML_LENGTH) return null
  // DOMParser builds an inert document: no scripts run, nothing loads.
  const doc = new DOMParser().parseFromString(html.replaceAll(BLANK_CODE_LINE, ''), 'text/html')
  if (!hasStructure(doc.body)) return null
  const trimmed = converter().turndown(doc.body).trim()
  if (!trimmed) return null
  const markdown = collapseBlankLines(trimmed).replaceAll(BLANK_CODE_LINE, '')
  if (isBlock(markdown)) return markdown
  const [first, last] = edgeSpaces(doc.body)
  return `${first ? ' ' : ''}${markdown}${last ? ' ' : ''}`
}

/**
 * Whether the content starts and ends with a space. Turndown trims both ends,
 * but a selected " bold " sits between words that are already in the document.
 * Only a space typed in the text counts: a newline is indentation in the
 * source, and an image or line break in the way means the text is not at the
 * edge.
 */
function edgeSpaces(body: HTMLElement): [boolean, boolean] {
  const nodes: Node[] = []
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE || (node as Element).matches(VOID)) nodes.push(node)
  }
  const edge = (list: Node[], test: RegExp): boolean => {
    for (const node of list) {
      if (node.nodeType !== Node.TEXT_NODE) return false
      const text = node.textContent ?? ''
      if (/\S/.test(text)) return test.test(text)
      if (text && !text.includes('\n')) return true
    }
    return false
  }
  return [edge(nodes, /^[ \u00a0]/), edge(nodes.reverse(), /[ \u00a0]$/)]
}

const VOID = 'img, br, hr, input'

/** One blank line at most between blocks. */
function collapseBlankLines(markdown: string): string {
  const out: string[] = []
  for (const line of markdown.split('\n')) {
    if (line.trim() === '' && out.length > 0 && out[out.length - 1].trim() === '') continue
    out.push(line)
  }
  return out.join('\n')
}

/** Whether markdown is made of blocks, which cannot share a line with text. */
function isBlock(markdown: string): boolean {
  return markdown.includes('\n') || /^(?:(?:[-*+]|\d+[.)]|#{1,6})\s|>|`{3}|~{3}|\||-{3,}$)/.test(markdown)
}

/**
 * Makes converted markdown fit where it lands. A block pasted against text on
 * its line would merge into that line (`Intro## Plan` is not a heading), so it
 * is set off from the text before and after it by a blank line.
 */
export function fitToLine(markdown: string, before: string, after: string): string {
  if (!isBlock(markdown)) return markdown
  return `${/\S/.test(before) ? '\n\n' : ''}${markdown}${/\S/.test(after) ? '\n\n' : ''}`
}

const STRUCTURE = [
  'a[href]', 'b', 'strong', 'i', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
  'blockquote', 'pre', 'code', 'table', 'img', 'hr', 'del', 's', 'strike',
].join(',')

function hasStructure(body: HTMLElement): boolean {
  if (body.querySelector(WORD_BULLET)) return true
  for (const element of body.querySelectorAll(STRUCTURE)) {
    // Google Docs wraps every copy in <b style="font-weight:normal">, and
    // JetBrains IDEs copy code as a styled <pre> with no <code> inside.
    if (!isPlainWrapper(element) && !isBarePre(element)) return true
  }
  for (const span of body.querySelectorAll('span[style]')) {
    if (docsStyles(span).length > 0) return true
  }
  return false
}

// Word writes this style exactly so on the span holding a list's bullet.
const WORD_BULLET = 'span[style*="mso-list:Ignore"]'

const styleOf = (element: Element): string => element.getAttribute('style') ?? ''
const isPlainWrapper = (element: Element): boolean =>
  element.nodeName === 'B' && /font-weight:\s*(normal|400)/.test(styleOf(element))
const isBarePre = (element: Element): boolean =>
  element.nodeName === 'PRE' && !element.querySelector('code')

/**
 * The emphasis a Google Docs span carries in its inline style. Only spans
 * inside a Docs copy count: code editors style keywords bold or italic too,
 * and that is syntax colouring, not emphasis.
 */
function docsStyles(element: Element): ('bold' | 'italic' | 'strike')[] {
  if (element.nodeName !== 'SPAN' || !element.closest('[id^="docs-internal-guid"]')) return []
  const style = styleOf(element)
  const found: ('bold' | 'italic' | 'strike')[] = []
  if (/font-weight:\s*(bold|[6-9]00)/.test(style)) found.push('bold')
  if (/font-style:\s*italic/.test(style)) found.push('italic')
  if (/text-decoration[^;]*line-through/.test(style)) found.push('strike')
  return found
}

/** The number of columns a table cell spans, clamped as browsers do. */
const spanOf = (cell: Element): number =>
  Math.min(1000, Math.max(1, Number(cell.getAttribute('colspan')) || 1))
const columnsOf = (row: Element): number =>
  Array.from(row.children).reduce((total, cell) => total + spanOf(cell), 0)

/**
 * Each table's width and header row, measured once: rows are converted one
 * at a time, and measuring per row would make a large spreadsheet paste
 * quadratic. The header is the first row with cells: a row with none is
 * dropped from the output, and the divider must follow the row that is not.
 */
const tableShapes = new WeakMap<Element, { width: number; header: Element | null }>()
function shapeOf(table: Element) {
  let shape = tableShapes.get(table)
  if (!shape) {
    const rows = Array.from(table.querySelectorAll('tr'))
    shape = { width: Math.max(0, ...rows.map(columnsOf)), header: rows.find((row) => row.firstElementChild) ?? null }
    tableShapes.set(table, shape)
  }
  return shape
}

function tableCell(content: string, node: Element): string {
  const first = node.parentElement?.firstElementChild === node
  const text = content.trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|')
  const merged = ' |'.repeat(spanOf(node) - 1)
  return `${first ? '| ' : ' '}${text} |${merged}`
}

/** Text of a <pre> with its line breaks, which textContent drops for <br>. */
function preText(node: Element): string {
  const copy = node.cloneNode(true) as Element
  for (const br of copy.querySelectorAll('br')) br.replaceWith('\n')
  return (copy.textContent ?? '').replace(/\n$/, '')
}

/** A fence longer than any run of backticks inside, so it cannot close early. */
function fence(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

let service: TurndownService | null = null

function converter(): TurndownService {
  if (service) return service
  service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
    // Empty cells and rows are still part of a table's shape.
    blankReplacement: (content, node) => {
      if (node.nodeName === 'TD' || node.nodeName === 'TH') return tableCell(content, node as Element)
      if (node.nodeName === 'TR') return ''
      return (node as unknown as { isBlock: boolean }).isBlock ? '\n\n' : ''
    },
  })
  const td: TurndownService = service
  service.remove(['style', 'script', 'noscript', 'meta', 'title', 'head'])

  service.addRule('plainWrapper', {
    filter: (node) => isPlainWrapper(node),
    replacement: (content) => content,
  })
  service.addRule('docsStyles', {
    filter: (node) => docsStyles(node).length > 0,
    replacement: (content, node) => {
      if (!content.trim()) return content
      const styles = docsStyles(node as Element)
      let text = content
      if (styles.includes('italic')) text = `*${text}*`
      if (styles.includes('bold')) text = `**${text}**`
      if (styles.includes('strike')) text = `~~${text}~~`
      return text
    },
  })
  // Word and Outlook draw list bullets as text in a hidden-on-screen span,
  // on paragraphs that are only styled to look like a list.
  service.addRule('wordListItem', {
    filter: (node) => node.nodeName === 'P' && !!node.querySelector(WORD_BULLET),
    replacement: (content, node) => {
      const element = node as Element
      const level = Number(/level(\d+)/.exec(styleOf(element))?.[1]) || 1
      const bullet = (element.querySelector(WORD_BULLET)?.textContent ?? '').replace(/\s/g, '')
      const number = /^(\d+)[.)]$/.exec(bullet)?.[1]
      const marker = number ? `${number}. ` : '- '
      const previous = element.previousElementSibling
      const continues = !!previous && previous.nodeName === 'P' && !!previous.querySelector(WORD_BULLET)
      return `${continues ? '' : '\n\n'}${'   '.repeat(Math.min(level, 9) - 1)}${marker}${content.trim()}\n`
    },
  })
  service.addRule('wordListBullet', {
    filter: (node) => node.nodeName === 'SPAN' && /mso-list:\s*Ignore/i.test(styleOf(node)),
    replacement: () => '',
  })
  // A link with no text would paste as a bare [](url).
  service.addRule('emptyLink', {
    filter: (node) => node.nodeName === 'A' && !node.textContent?.trim() && !node.querySelector('img'),
    replacement: () => '',
  })
  // Inline image data and temp-file paths (Word, Outlook) would put
  // megabytes of base64 or a dead path into the document; keep the alt text.
  // Alt text, title and address come from the page, so each is made safe to
  // sit inside ![](): escaped, on one line, with no bracket or space that
  // could end the address early.
  const escape = (text: string): string => td.escape(text.replace(/\s+/g, ' ').trim())
  service.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const image = node as Element
      const src = (image.getAttribute('src') ?? '').trim()
      const alt = escape(image.getAttribute('alt') ?? '')
      if (!src) return ''
      if (/^(data|file|blob):/i.test(src)) return alt
      const address = src.replace(/[\s()<>]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)))
      const title = (image.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim().replace(/[\\"]/g, '\\$&')
      return `![${alt}](${address}${title ? ` "${title}"` : ''})`
    },
  })
  service.addRule('codeBlock', {
    filter: 'pre',
    replacement: (_content, node) => {
      const element = node as Element
      const code = preText(element)
      const language = /language-([\w+#.-]+)/.exec(element.querySelector('code')?.getAttribute('class') ?? '')?.[1] ?? ''
      const marks = fence(code)
      // Blank lines are marked so tidying the blocks' spacing leaves them be.
      const body = code.replace(/^[ \t]*$/gm, (blank) => blank + BLANK_CODE_LINE)
      return `\n\n${marks}${language}\n${body}\n${marks}\n\n`
    },
  })
  // "- item" rather than Turndown's "-   item", with nested lines indented
  // to sit under the item's text.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentElement
      let prefix = `${options.bulletListMarker} `
      if (parent?.nodeName === 'OL') {
        const start = Number.parseInt(parent.getAttribute('start') ?? '', 10)
        const index = Array.prototype.indexOf.call(parent.children, node)
        prefix = `${(Number.isFinite(start) ? start : 1) + index}. `
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/gm, `\n${' '.repeat(prefix.length)}`)
      return prefix + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '')
    },
  })
  service.addRule('strikethrough', {
    filter: ['del', 's', 'strike'] as never,
    replacement: (content) => `~~${content}~~`,
  })
  service.addRule('taskCheckbox', {
    filter: (node) =>
      node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox' && !!node.parentElement?.closest('li'),
    replacement: (_content, node) => {
      const box = (node as HTMLInputElement).hasAttribute('checked') ? '[x]' : '[ ]'
      const spaced = /^\s/.test(node.nextSibling?.textContent ?? '')
      return spaced ? box : `${box} `
    },
  })

  // GFM tables. The first row is the header, as GFM requires one, and every
  // row is padded to the widest so merged cells do not drop columns.
  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => tableCell(content, node as Element),
  })
  service.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      const row = node as Element
      const table = row.closest('table')
      const { width, header } = table ? shapeOf(table) : { width: columnsOf(row), header: row }
      const padding = ' |'.repeat(Math.max(0, width - columnsOf(row)))
      const divider = header === row ? `\n|${' --- |'.repeat(width)}` : ''
      return `\n${content}${padding}${divider}`
    },
  })
  // A caption line directly above the rows would stop them parsing as a table.
  service.addRule('tableCaption', {
    filter: 'caption',
    replacement: () => '',
  })
  service.addRule('table', {
    filter: 'table',
    replacement: (content, node) => {
      const caption = (node as Element).querySelector('caption')?.textContent?.trim()
      return `\n\n${caption ? `${caption}\n\n` : ''}${content.trim()}\n\n`
    },
  })
  service.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: (content) => content,
  })
  return service
}
