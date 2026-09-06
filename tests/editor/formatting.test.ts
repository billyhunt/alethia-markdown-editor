import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { markdownExtension } from '../../src/renderer/editor/markdownLanguage.ts'
import {
  insertHorizontalRule,
  insertLink,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
} from '../../src/renderer/editor/extensions/formatting.ts'

/** Runs a command against a doc and selection, returning the resulting text. */
function run(
  command: StateCommand,
  doc: string,
  range: { from: number; to?: number },
): { doc: string; selection: { from: number; to: number } } {
  let state = EditorState.create({ doc, extensions: [markdownExtension] })
  state = state.update({
    selection:
      range.to === undefined
        ? EditorSelection.cursor(range.from)
        : EditorSelection.range(range.from, range.to),
  }).state

  let next = state
  command({
    state,
    dispatch: (tr) => {
      next = tr.state
    },
  })
  const main = next.selection.main
  return { doc: next.doc.toString(), selection: { from: main.from, to: main.to } }
}

describe('inline emphasis', () => {
  it('wraps a selection and keeps it selected inside the delimiters', () => {
    const out = run(toggleBold, 'make this bold', { from: 5, to: 9 })
    expect(out.doc).toBe('make **this** bold')
    expect(out.doc.slice(out.selection.from, out.selection.to)).toBe('this')
  })

  it('inserts an empty pair with the caret between when nothing is selected', () => {
    const out = run(toggleBold, 'ab', { from: 1 })
    expect(out.doc).toBe('a****b')
    expect(out.selection).toEqual({ from: 3, to: 3 })
  })

  it('unwraps when the caret is already inside the emphasis', () => {
    const out = run(toggleBold, 'make **this** bold', { from: 8 })
    expect(out.doc).toBe('make this bold')
  })

  it('uses one delimiter for italic and two for bold', () => {
    expect(run(toggleItalic, 'a b', { from: 0, to: 1 }).doc).toBe('*a* b')
    expect(run(toggleBold, 'a b', { from: 0, to: 1 }).doc).toBe('**a** b')
  })

  it('handles strikethrough and inline code', () => {
    expect(run(toggleStrikethrough, 'gone', { from: 0, to: 4 }).doc).toBe('~~gone~~')
    expect(run(toggleInlineCode, 'code', { from: 0, to: 4 }).doc).toBe('`code`')
  })

  it('round-trips: wrapping then unwrapping restores the original', () => {
    const wrapped = run(toggleBold, 'hello world', { from: 0, to: 5 })
    expect(wrapped.doc).toBe('**hello** world')
    expect(run(toggleBold, wrapped.doc, { from: 4 }).doc).toBe('hello world')
  })
})

describe('setHeading', () => {
  it('adds the requested level', () => {
    expect(run(setHeading(2), 'Title', { from: 0 }).doc).toBe('## Title')
  })

  it('replaces an existing level rather than stacking hashes', () => {
    expect(run(setHeading(3), '# Title', { from: 2 }).doc).toBe('### Title')
  })

  it('level 0 strips the heading back to a paragraph', () => {
    expect(run(setHeading(0), '### Title', { from: 5 }).doc).toBe('Title')
  })

  it('applies to every line the selection touches', () => {
    const out = run(setHeading(1), 'one\ntwo', { from: 0, to: 7 })
    expect(out.doc).toBe('# one\n# two')
  })
})

describe('line prefixes', () => {
  it('adds a quote marker and removes it when every line already has one', () => {
    const quoted = run(toggleBlockquote, 'text', { from: 0 })
    expect(quoted.doc).toBe('> text')
    expect(run(toggleBlockquote, quoted.doc, { from: 3 }).doc).toBe('text')
  })

  it('adds a bullet marker and toggles it off again', () => {
    const listed = run(toggleBulletList, 'item', { from: 0 })
    expect(listed.doc).toBe('- item')
    expect(run(toggleBulletList, listed.doc, { from: 3 }).doc).toBe('item')
  })

  it('numbers an ordered list sequentially across the selection', () => {
    const out = run(toggleOrderedList, 'one\ntwo\nthree', { from: 0, to: 13 })
    expect(out.doc).toBe('1. one\n2. two\n3. three')
  })

  it('preserves indentation when prefixing', () => {
    expect(run(toggleBlockquote, '    text', { from: 5 }).doc).toBe('    > text')
  })
})

describe('insertLink', () => {
  it('wraps the selection and puts the caret in the parens', () => {
    const out = run(insertLink, 'see example here', { from: 4, to: 11 })
    expect(out.doc).toBe('see [example]() here')
    // Caret between the parentheses, ready for the URL.
    expect(out.selection.from).toBe(out.doc.indexOf(']()') + 2)
  })

  it('inserts an empty link with the caret in the brackets', () => {
    const out = run(insertLink, '', { from: 0 })
    expect(out.doc).toBe('[]()')
    expect(out.selection).toEqual({ from: 1, to: 1 })
  })
})

describe('insertHorizontalRule', () => {
  it('writes a bare rule on an empty line', () => {
    expect(run(insertHorizontalRule, '', { from: 0 }).doc).toBe('---\n')
  })

  it('surrounds the rule with blank lines when the line has content', () => {
    expect(run(insertHorizontalRule, 'text', { from: 4 }).doc).toBe('text\n\n---\n\n')
  })
})
