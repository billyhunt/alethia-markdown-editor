import TurndownService from 'turndown'

/**
 * Converts clipboard HTML to markdown, so text copied from a web page or a
 * document keeps its headings, links, lists, emphasis and tables.
 *
 * Returns null when the HTML carries no structure worth keeping -- code
 * editors and terminals put plain text on the clipboard wrapped in styled
 * spans or a bare <pre>, and converting that would only add backslash
 * escapes to code.
 */
export function htmlToMarkdown(html: string): string | null {
  // DOMParser builds an inert document: no scripts run, nothing loads.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!hasStructure(doc.body)) return null
  const markdown = converter().turndown(doc.body).trim()
  return markdown ? collapseBlankLines(markdown) : null
}

/** One blank line at most between blocks; code keeps its blank lines. */
function collapseBlankLines(markdown: string): string {
  const out: string[] = []
  let fenceOpen: string | null = null
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fenceOpen === null) {
      if (marker) fenceOpen = marker
      else if (line.trim() === '' && out.length > 0 && out[out.length - 1].trim() === '') continue
    } else if (marker && marker[0] === fenceOpen[0] && marker.length >= fenceOpen.length && !line.trim().slice(marker.length).trim()) {
      fenceOpen = null
    }
    out.push(line)
  }
  return out.join('\n')
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
 * quadratic.
 */
const tableShapes = new WeakMap<Element, { width: number; header: Element | null }>()
function shapeOf(table: Element) {
  let shape = tableShapes.get(table)
  if (!shape) {
    const rows = Array.from(table.querySelectorAll('tr'))
    shape = { width: Math.max(0, ...rows.map(columnsOf)), header: rows[0] ?? null }
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
  service.addRule('localImage', {
    filter: (node) => node.nodeName === 'IMG' && /^(data|file|blob):/i.test(node.getAttribute('src') ?? ''),
    replacement: (_content, node) => (node as Element).getAttribute('alt') ?? '',
  })
  service.addRule('barePre', {
    filter: (node) => isBarePre(node),
    replacement: (_content, node) => {
      const code = preText(node as Element)
      return `\n\n${fence(code)}\n${code}\n${fence(code)}\n\n`
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
