import type { Extension } from '@codemirror/state'
import { inlineDecorations } from './inlineDecorations.ts'
import { revealState } from './revealState.ts'

/** The live-preview layer: rendering markdown in place as you move the caret. */
export const livePreview = (): Extension => [revealState(), inlineDecorations]
