import type { EditorState, Line } from '@codemirror/state'
import { revealEnabled } from './revealState.ts'

/**
 * The single rule the whole live-preview engine turns on: a node shows its
 * raw markdown when the selection touches it, and renders otherwise.
 *
 * Endpoints rather than full-range intersection, so a long drag-selection
 * leaves everything rendered except the nodes at its two ends -- selecting the
 * whole document should not dump you back into raw source.
 *
 * Bounds are inclusive: a caret sitting just after a closing `**` counts as
 * inside, so typing there continues after the mark and arrowing left reveals
 * the syntax *before* the caret enters it.
 */
export function isActive(state: EditorState, from: number, to: number): boolean {
  if (!state.field(revealEnabled, false)) return false
  for (const range of state.selection.ranges) {
    if (range.head >= from && range.head <= to) return true
    if (range.anchor >= from && range.anchor <= to) return true
  }
  return false
}

export const lineIsActive = (state: EditorState, line: Line): boolean =>
  isActive(state, line.from, line.to)
