import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { OutlineEntry } from '../state/workspaceStore.ts'

// Words are letter/number runs, allowing internal apostrophes and hyphens, so
// "don't" and "well-known" each count once.
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export const countWords = (text: string): number => text.match(WORD)?.length ?? 0

/** Characters excluding line separators, matching what writing tools report. */
export const countChars = (state: EditorState): number => state.doc.length - (state.doc.lines - 1)

const HEADING = /^(ATXHeading|SetextHeading)([1-6])$/

export function extractOutline(state: EditorState): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  syntaxTree(state).iterate({
    enter: (ref) => {
      const match = HEADING.exec(ref.name)
      if (!match) return true
      const line = state.doc.lineAt(ref.from)
      const text = line.text
        .replace(/^\s*#+\s*/, '')
        .replace(/\s*#+\s*$/, '')
        .trim()
      if (text) entries.push({ level: Number(match[2]), text, pos: ref.from })
      // Headings never nest, so there is nothing useful inside one.
      return false
    },
  })
  return entries
}
