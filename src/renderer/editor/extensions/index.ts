import type { Extension } from '@codemirror/state'
import { inlineDecorations } from './inlineDecorations.ts'
import { blockDecorations } from './blockDecorations.ts'
import { revealState } from './revealState.ts'
import { tableNavigation } from './tableNavigation.ts'

/** The live-preview layer: rendering markdown in place as the caret moves. */
export const livePreview = (): Extension => [
  revealState(),
  inlineDecorations,
  blockDecorations(),
  tableNavigation(),
]
