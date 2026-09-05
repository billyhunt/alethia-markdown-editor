import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { StateField, type Extension, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { isActive } from './activeRanges.ts'
import { parseTable } from './tableModel.ts'
import { TableWidget } from '../widgets/TableWidget.ts'
import { MathWidget } from '../widgets/MathWidget.ts'

/**
 * Decorations that span more than one line.
 *
 * These cannot live in a ViewPlugin: CodeMirror forbids plugin decorations
 * from changing line structure, and replacing a whole table with a single
 * widget does exactly that.
 */
function build(state: Parameters<typeof syntaxTree>[0]): DecorationSet {
  const ranges: Range<Decoration>[] = []

  syntaxTree(state).iterate({
    enter: (ref) => {
      switch (ref.name) {
        // Nothing multi-line lives inside these, so skip the subtree.
        case 'Paragraph':
        case 'FencedCode':
        case 'CodeBlock':
        case 'HTMLBlock':
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6':
          return false

        case 'BlockMath': {
          const first = state.doc.lineAt(ref.from)
          const last = state.doc.lineAt(ref.to)
          if (!isActive(state, first.from, last.to)) {
            // Strip the `$$` fence lines; only the body is TeX.
            const source = state.doc.sliceString(
              state.doc.line(Math.min(first.number + 1, last.number)).from,
              state.doc.line(Math.max(last.number - 1, first.number)).to,
            )
            ranges.push(
              Decoration.replace({ widget: new MathWidget(source, true), block: true }).range(
                first.from,
                last.to,
              ),
            )
          }
          return false
        }

        case 'Table': {
          const model = parseTable(state, ref.node)
          if (isActive(state, model.from, model.to)) {
            // Editing: show the raw pipes in monospace instead.
            for (let n = state.doc.lineAt(model.from).number; n <= state.doc.lineAt(model.to).number; n += 1) {
              ranges.push(Decoration.line({ class: 'cm-md-table-raw' }).range(state.doc.line(n).from))
            }
          } else {
            ranges.push(
              Decoration.replace({ widget: new TableWidget(model), block: true }).range(
                model.from,
                model.to,
              ),
            )
          }
          return false
        }

        default:
          return true
      }
    },
  })

  return Decoration.set(ranges, true)
}

const blockDecorationField = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update(value, tr) {
    // The tree comparison matters: lezer parses long documents incrementally
    // in idle time, and without it later tables never render.
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState)
    if (tr.docChanged || tr.selection || treeChanged) return build(tr.state)
    return value.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const blockDecorations = (): Extension => blockDecorationField
