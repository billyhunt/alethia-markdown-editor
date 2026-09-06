import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { markdownExtension } from '../../src/renderer/editor/markdownLanguage.ts'
import { navigableCells, parseTable } from '../../src/renderer/editor/extensions/tableModel.ts'

function tableIn(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdownExtension] })
  let node: SyntaxNode | null = null
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Table' && !node) node = ref.node
      return true
    },
  })
  if (!node) throw new Error('no Table node parsed')
  return { state, model: parseTable(state, node) }
}

const text = (model: ReturnType<typeof parseTable>) =>
  model.rows.map((row) => row.map((c) => c.text))

describe('parseTable', () => {
  it('splits header, delimiter and body rows', () => {
    const { model } = tableIn(['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n'))
    expect(text(model)).toEqual([
      ['A', 'B'],
      ['---', '---'],
      ['1', '2'],
    ])
    expect(model.delimiterRow).toBe(1)
  })

  it('reads alignment from the delimiter row', () => {
    const { model } = tableIn(['| A | B | C |', '|:--|:-:|--:|', '| 1 | 2 | 3 |'].join('\n'))
    expect(model.aligns).toEqual(['left', 'center', 'right'])
  })

  it('leaves unmarked columns without an alignment', () => {
    const { model } = tableIn(['| A |', '|---|', '| 1 |'].join('\n'))
    expect(model.aligns).toEqual([null])
  })

  it('keeps empty cells, which lezer omits nodes for', () => {
    // An empty cell still needs a caret position, which is why cells come
    // from splitting the line rather than from TableCell nodes.
    const { model } = tableIn(['| A | B |', '|---|---|', '| 1 |   |'].join('\n'))
    expect(text(model)[2]).toEqual(['1', ''])
  })

  it('does not split on an escaped pipe', () => {
    const { model } = tableIn(['| A | B |', '|---|---|', '| a \\| b | c |'].join('\n'))
    expect(text(model)[2]).toEqual(['a \\| b', 'c'])
  })

  it('records offsets that point at the trimmed cell text', () => {
    const doc = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')
    const { state, model } = tableIn(doc)
    const cell = model.rows[2][1]
    expect(state.doc.sliceString(cell.from, cell.to)).toBe('2')
  })

  it('spans from the first line start to the last line end', () => {
    const doc = ['| A |', '|---|', '| 1 |'].join('\n')
    const { model } = tableIn(doc)
    expect(model.from).toBe(0)
    expect(model.to).toBe(doc.length)
  })
})

describe('navigableCells', () => {
  it('skips the delimiter row so Tab never lands in it', () => {
    const { model } = tableIn(['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n'))
    expect(navigableCells(model).map((c) => c.text)).toEqual(['A', 'B', '1', '2'])
  })
})
