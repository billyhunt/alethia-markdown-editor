import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdownExtension } from '../../src/renderer/editor/markdownLanguage.ts'
import { buildDecorations } from '../../src/renderer/editor/extensions/inlineDecorations.ts'
import { OrderedHangWidget } from '../../src/renderer/editor/widgets/index.ts'

/** Each ordered-list number: the text its mark covers and how far it hangs. */
function numbers(doc: string): { text: string; hang: number }[] {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [markdownExtension] }) })
  const { decorations } = buildDecorations(view)
  view.destroy()
  const hangs = new Map<number, number>()
  for (const range of decorations) {
    const widget = range.value.spec.widget
    if (widget instanceof OrderedHangWidget) hangs.set(range.from, widget.chars)
  }
  return decorations
    .filter((range) => range.value.spec.class === 'cm-md-ol-mark')
    .map((range) => ({ text: doc.slice(range.from, range.to), hang: hangs.get(range.from) ?? 0 }))
}

describe('ordered list numbers in live preview', () => {
  it('take their following space and hang by exactly that width', () => {
    expect(numbers('1. one\n2. two\n')).toEqual([
      { text: '1. ', hang: 3 },
      { text: '2. ', hang: 3 },
    ])
  })

  it('hang further for a wider number, so the text column does not move', () => {
    expect(numbers('9. nine\n10. ten\n')).toEqual([
      { text: '9. ', hang: 3 },
      { text: '10. ', hang: 4 },
    ])
  })

  it('hang a nested numbered item from its own column', () => {
    expect(numbers('- parent\n  1. child\n')).toEqual([{ text: '1. ', hang: 3 }])
  })

  it('cover just the number when nothing follows it', () => {
    expect(numbers('1.\n')).toEqual([{ text: '1.', hang: 2 }])
  })
})
