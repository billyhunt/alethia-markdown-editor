import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { navigableCells, parseTable } from './tableModel.ts'

/** The Table node containing the caret, if there is one. */
function enclosingTable(state: Parameters<typeof syntaxTree>[0], pos: number): SyntaxNode | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (node.name === 'Table') return node
  }
  return null
}

function moveCell(offset: number): Command {
  return (view) => {
    const pos = view.state.selection.main.head
    const table = enclosingTable(view.state, pos)
    if (!table) return false

    const model = parseTable(view.state, table)
    const cells = navigableCells(model)
    const index = cells.findIndex((cell) => pos >= cell.from && pos <= cell.to)
    if (index < 0) return false

    const target = cells[index + offset]
    if (target) {
      view.dispatch({ selection: EditorSelection.cursor(target.to), scrollIntoView: true })
      return true
    }

    // Tab past the last cell appends a row, matching what spreadsheets do.
    if (offset > 0) {
      const columns = model.rows[0]?.length ?? 1
      const insert = `\n| ${Array.from({ length: columns }, () => ' ').join('|')}`.replace(
        /\|\s\|/g,
        '|  |',
      )
      const at = model.to
      view.dispatch({
        changes: { from: at, insert },
        selection: EditorSelection.cursor(at + 3),
        scrollIntoView: true,
      })
      return true
    }
    return false
  }
}

/**
 * Highest precedence so Tab reaches the table before the list-indent and
 * default handlers get a chance at it.
 */
export const tableNavigation = (): Extension =>
  Prec.highest(
    keymap.of([
      { key: 'Tab', run: moveCell(1) },
      { key: 'Shift-Tab', run: moveCell(-1) },
    ]),
  )
