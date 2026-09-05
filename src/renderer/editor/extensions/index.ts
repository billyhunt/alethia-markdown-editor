import type { Extension } from '@codemirror/state'
import { inlineDecorations } from './inlineDecorations.ts'
import { blockDecorations } from './blockDecorations.ts'
import { revealState } from './revealState.ts'
import { tableNavigation } from './tableNavigation.ts'
import { linkClick } from './linkClick.ts'
import { modesCompartment } from './modes.ts'

/** The live-preview layer: rendering markdown in place as the caret moves. */
export const livePreview = (): Extension => [
  revealState(),
  inlineDecorations,
  blockDecorations(),
  tableNavigation(),
  linkClick(),
  // Focus and typewriter modes are reconfigured in, never rebuilt.
  modesCompartment.of([]),
]
