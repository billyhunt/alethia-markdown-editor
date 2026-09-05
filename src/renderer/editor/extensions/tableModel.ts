import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export interface TableCell {
  from: number
  to: number
  text: string
}

export interface TableModel {
  rows: TableCell[][]
  aligns: Array<'left' | 'center' | 'right' | null>
  /** Index into `rows` of the `|:--|--:|` separator row. */
  delimiterRow: number
  from: number
  to: number
}

/**
 * Cells are derived by splitting each line on unescaped pipes rather than from
 * lezer's TableCell nodes, which are omitted entirely for empty cells -- and an
 * empty cell still needs a caret position.
 */
function splitRow(text: string, lineFrom: number): TableCell[] {
  const cells: TableCell[] = []
  let start = 0
  let escaped = false

  const push = (end: number) => {
    const raw = text.slice(start, end)
    const leading = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    cells.push({
      from: lineFrom + start + leading,
      to: lineFrom + start + leading + trimmed.length,
      text: trimmed,
    })
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      push(i)
      start = i + 1
    }
  }
  push(text.length)

  // Leading and trailing pipes produce empty edge cells that are not real.
  if (cells.length > 0 && cells[0].text === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1].text === '') cells.pop()
  return cells
}

const DELIMITER = /^\s*:?-{1,}:?\s*$/

export function parseTable(state: EditorState, node: SyntaxNode): TableModel {
  const first = state.doc.lineAt(node.from)
  const last = state.doc.lineAt(node.to)
  const rows: TableCell[][] = []
  let delimiterRow = -1

  for (let n = first.number; n <= last.number; n += 1) {
    const line = state.doc.line(n)
    const cells = splitRow(line.text, line.from)
    if (delimiterRow < 0 && cells.length > 0 && cells.every((cell) => DELIMITER.test(cell.text))) {
      delimiterRow = rows.length
    }
    rows.push(cells)
  }

  const aligns = (delimiterRow >= 0 ? rows[delimiterRow] : []).map((cell) => {
    const left = cell.text.startsWith(':')
    const right = cell.text.endsWith(':')
    if (left && right) return 'center' as const
    if (right) return 'right' as const
    if (left) return 'left' as const
    return null
  })

  return { rows, aligns, delimiterRow, from: first.from, to: last.to }
}

/** Flattened cell list in visual order, excluding the delimiter row. */
export function navigableCells(model: TableModel): TableCell[] {
  return model.rows.flatMap((row, index) => (index === model.delimiterRow ? [] : row))
}
