import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { isActive, lineIsActive } from '../../src/renderer/editor/extensions/activeRanges.ts'
import { revealEnabled, revealState } from '../../src/renderer/editor/extensions/revealState.ts'

const DOC = 'first line\nsecond line\nthird line'

/** A state with the reveal gate armed, as it is after any caret placement. */
function armed(cursor: number): EditorState {
  const base = EditorState.create({ doc: DOC, extensions: [revealState()] })
  return base.update({ selection: EditorSelection.cursor(cursor) }).state
}

describe('revealEnabled', () => {
  it('starts closed so a freshly loaded document renders whole', () => {
    // Offset 0 sits inside the first node, so an ungated caret check would
    // reveal the top of every file the instant it opened.
    const state = EditorState.create({ doc: DOC, extensions: [revealState()] })
    expect(state.field(revealEnabled)).toBe(false)
    expect(isActive(state, 0, 5)).toBe(false)
  })

  it('opens on the first transaction carrying a selection', () => {
    expect(armed(3).field(revealEnabled)).toBe(true)
  })

  it('stays open afterwards, including across plain edits', () => {
    const next = armed(3).update({ changes: { from: 0, insert: 'x' } }).state
    expect(next.field(revealEnabled)).toBe(true)
  })

  it('reports false rather than throwing when the field is absent', () => {
    // isActive is called from decoration code that may run against a state
    // built without the extension.
    const bare = EditorState.create({ doc: DOC })
    expect(isActive(bare, 0, 5)).toBe(false)
  })
})

describe('isActive', () => {
  it('is true when the caret sits inside the range', () => {
    expect(isActive(armed(3), 0, 10)).toBe(true)
  })

  it('is inclusive at both bounds', () => {
    // Typing just after a closing delimiter should continue outside it, and
    // arrowing back in should reveal the syntax before the caret enters.
    expect(isActive(armed(0), 0, 10)).toBe(true)
    expect(isActive(armed(10), 0, 10)).toBe(true)
  })

  it('is false just outside the range', () => {
    expect(isActive(armed(11), 0, 10)).toBe(false)
  })

  it('uses selection endpoints, not intersection, so select-all stays rendered', () => {
    const state = EditorState.create({ doc: DOC, extensions: [revealState()] })
      .update({ selection: EditorSelection.range(0, DOC.length) })
      .state
    // A range in the middle is spanned by the selection but touched by
    // neither endpoint, so it keeps rendering.
    expect(isActive(state, 14, 18)).toBe(false)
    // The nodes at the two ends do reveal.
    expect(isActive(state, 0, 4)).toBe(true)
    expect(isActive(state, DOC.length - 4, DOC.length)).toBe(true)
  })

  it('considers every cursor of a multi-range selection', () => {
    // Without the facet the state collapses this to a single range.
    const state = EditorState.create({
      doc: DOC,
      extensions: [revealState(), EditorState.allowMultipleSelections.of(true)],
    })
      .update({
        selection: EditorSelection.create([
          EditorSelection.cursor(2),
          EditorSelection.cursor(25),
        ]),
      }).state
    expect(state.selection.ranges).toHaveLength(2)
    expect(isActive(state, 0, 4)).toBe(true)
    expect(isActive(state, 24, 28)).toBe(true)
    expect(isActive(state, 12, 16)).toBe(false)
  })
})

describe('lineIsActive', () => {
  it('is true anywhere on the caret line and false on its neighbours', () => {
    const state = armed(14) // second line
    expect(lineIsActive(state, state.doc.line(2))).toBe(true)
    expect(lineIsActive(state, state.doc.line(1))).toBe(false)
    expect(lineIsActive(state, state.doc.line(3))).toBe(false)
  })
})
