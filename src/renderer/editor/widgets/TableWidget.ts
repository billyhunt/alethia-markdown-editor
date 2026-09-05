import { WidgetType, EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { renderInlineMarkdown } from '../inlineToDom.ts'
import type { TableModel } from '../extensions/tableModel.ts'

/** A rendered GFM table, shown whenever the caret is outside it. */
export class TableWidget extends WidgetType {
  readonly model: TableModel
  private readonly key: string

  constructor(model: TableModel) {
    super()
    this.model = model
    this.key =
      model.rows.map((row) => row.map((cell) => cell.text).join('')).join('') +
      '|' +
      model.aligns.join(',')
  }

  eq(other: TableWidget): boolean {
    return other.key === this.key
  }

  toDOM(view: EditorView): HTMLElement {
    const table = document.createElement('table')
    table.className = 'cm-md-table'

    this.model.rows.forEach((row, rowIndex) => {
      if (rowIndex === this.model.delimiterRow) return
      const isHeader = this.model.delimiterRow > 0 && rowIndex < this.model.delimiterRow
      const tr = document.createElement('tr')

      row.forEach((cell, columnIndex) => {
        const td = document.createElement(isHeader ? 'th' : 'td')
        const align = this.model.aligns[columnIndex]
        if (align) td.style.textAlign = align
        td.appendChild(renderInlineMarkdown(cell.text))
        // Clicking a rendered cell lands the caret in that cell's source.
        td.addEventListener('mousedown', (event) => {
          event.preventDefault()
          view.dispatch({ selection: EditorSelection.cursor(cell.from) })
          view.focus()
        })
        tr.appendChild(td)
      })

      table.appendChild(tr)
    })

    const wrapper = document.createElement('div')
    wrapper.className = 'cm-md-table-wrap'
    wrapper.appendChild(table)
    return wrapper
  }

  /** Cell clicks are handled above; CodeMirror must not also move the caret. */
  ignoreEvent(): boolean {
    return true
  }
}
