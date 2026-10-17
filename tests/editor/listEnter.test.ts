import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view'
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

describe('Enter with multiple cursors', () => {
  it('does not duplicate numbers when two empty items are removed at once', () => {
    const doc = '1. one\n2. \n3. three\n4. \n5. five'
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.create([
          EditorSelection.cursor(doc.indexOf('2. ') + 3),
          EditorSelection.cursor(doc.indexOf('4. ') + 3),
        ]),
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          markdownExtension,
          keymap.of(defaultKeymap),
        ],
      }),
    })
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
    const text = view.state.doc.toString()
    view.destroy()
    expect(text.split('\n').filter((l) => l.includes('five'))).toEqual(['5. five'])
  })
})
