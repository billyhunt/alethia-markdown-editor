import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { markdownExtension } from '../../src/renderer/editor/markdownLanguage.ts'

/** Presses Enter `times` with the caret at the end of `doc`, as the user would. */
function pressEnter(doc: string, times: number): string {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdownExtension],
    }),
  })
  for (let i = 0; i < times; i += 1) {
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
  }
  const text = view.state.doc.toString()
  view.destroy()
  return text
}

describe('Enter in a list', () => {
  it('continues the list on the first press', () => {
    expect(pressEnter('- one', 1)).toBe('- one\n- ')
  })

  it('ends a one-item list on the second press', () => {
    expect(pressEnter('- one', 2)).toBe('- one\n')
  })

  it('ends a one-item numbered list on the second press', () => {
    expect(pressEnter('1. one', 2)).toBe('1. one\n')
  })

  it('ends a longer list on the second press, as before', () => {
    expect(pressEnter('- a\n- b', 2)).toBe('- a\n- b\n')
  })

  it('still continues a quote', () => {
    expect(pressEnter('> quoted', 1)).toBe('> quoted\n> ')
  })
})
