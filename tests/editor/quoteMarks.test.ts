import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdownExtension } from '../../src/renderer/editor/markdownLanguage.ts'
import { buildDecorations } from '../../src/renderer/editor/extensions/inlineDecorations.ts'

/** The hidden ranges live preview builds for `doc`, in document order. */
function hiddenRanges(doc: string): [number, number][] {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [markdownExtension] }) })
  const ranges = buildDecorations(view).atomic.map((range) => [range.from, range.to] as [number, number])
  view.destroy()
  return ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** The document as live preview shows it, with every hidden range cut out. */
function shown(doc: string): string {
  let text = ''
  let at = 0
  for (const [from, to] of hiddenRanges(doc)) {
    if (from > at) text += doc.slice(at, from)
    at = Math.max(at, to)
  }
  return text + doc.slice(at)
}

/** Ranges that overlap one another: each hidden character should have one owner. */
function overlaps(doc: string): [number, number][] {
  const ranges = hiddenRanges(doc)
  return ranges.filter((range, i) => i > 0 && range[0] < ranges[i - 1][1])
}

describe('quote marks in live preview', () => {
  it('hides the marker on every line of a multi-line quote', () => {
    expect(shown('> first line\n> second line\n')).toBe('first line\nsecond line\n')
  })

  it('hides each marker of a nested quote exactly once', () => {
    const doc = '> outer\n> > inner\n> > more\n'
    expect(shown(doc)).toBe('outer\ninner\nmore\n')
    expect(overlaps(doc)).toEqual([])
  })

  it('hides the markers on the code lines of a quoted fence', () => {
    expect(shown('> ```\n> let a = 1\n> let b = 2\n> ```\n')).not.toContain('> let')
  })

  it('hides a quoted list marker once, not from both the list and the quote', () => {
    const doc = '> - one\n> - two\n'
    expect(shown(doc)).not.toContain('>')
    expect(overlaps(doc)).toEqual([])
  })
})
