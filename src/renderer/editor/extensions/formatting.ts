import { EditorSelection, type ChangeSpec, type StateCommand } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

/** Smallest ancestor of `pos` with the given node name, if the range is inside it. */
function enclosing(
  state: Parameters<StateCommand>[0]['state'],
  from: number,
  to: number,
  name: string,
): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1); node; node = node.parent) {
    if (node.name === name && node.from <= from && node.to >= to) return node
  }
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (node.name === name && node.from <= from && node.to >= to) return node
  }
  return null
}

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) out.push(child)
  }
  return out
}

/**
 * Toggles a paired inline delimiter. When the caret is already inside a node
 * of `nodeName` the existing marks are removed; otherwise the delimiters are
 * inserted around the selection (or an empty pair with the caret between).
 */
function toggleWrap(delimiter: string, nodeName: string, markName: string): StateCommand {
  return ({ state, dispatch }) => {
    const spec = state.changeByRange((range) => {
      const node = enclosing(state, range.from, range.to, nodeName)

      if (node) {
        // Already wrapped: strip the delimiters and keep the caret on the same
        // characters by shifting it left past whatever was removed before it.
        const marks = childrenNamed(node, markName)
        if (marks.length > 0) {
          const changes = marks.map((mark) => ({ from: mark.from, to: mark.to, insert: '' }))
          const removedBefore = (pos: number) =>
            marks.reduce((sum, m) => (m.to <= pos ? sum + (m.to - m.from) : sum), 0)
          return {
            changes,
            range: EditorSelection.range(
              range.from - removedBefore(range.from),
              range.to - removedBefore(range.to),
            ),
          }
        }
      }

      if (range.empty) {
        return {
          changes: { from: range.from, insert: delimiter + delimiter },
          range: EditorSelection.cursor(range.from + delimiter.length),
        }
      }

      return {
        changes: [
          { from: range.from, insert: delimiter },
          { from: range.to, insert: delimiter },
        ],
        // Keep the original text selected, now sitting inside the delimiters.
        range: EditorSelection.range(
          range.from + delimiter.length,
          range.to + delimiter.length,
        ),
      }
    })

    dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input.format' }))
    return true
  }
}

export const toggleBold = toggleWrap('**', 'StrongEmphasis', 'EmphasisMark')
export const toggleItalic = toggleWrap('*', 'Emphasis', 'EmphasisMark')
export const toggleStrikethrough = toggleWrap('~~', 'Strikethrough', 'StrikethroughMark')
export const toggleInlineCode = toggleWrap('`', 'InlineCode', 'CodeMark')

/** Sets or clears an ATX heading level on every line in the selection. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = []
    const seen = new Set<number>()
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number
      const last = state.doc.lineAt(range.to).number
      for (let n = first; n <= last; n += 1) {
        if (seen.has(n)) continue
        seen.add(n)
        const line = state.doc.line(n)
        const existing = /^\s{0,3}#{1,6}\s+/.exec(line.text)
        const prefix = level > 0 ? `${'#'.repeat(level)} ` : ''
        changes.push({
          from: line.from,
          to: line.from + (existing?.[0].length ?? 0),
          insert: prefix,
        })
      }
    }
    if (changes.length === 0) return false
    dispatch(state.update({ changes, userEvent: 'input.format' }))
    return true
  }
}

/** Prefixes each selected line, or strips the prefix if every line has it. */
function toggleLinePrefix(prefix: string): StateCommand {
  return ({ state, dispatch }) => {
    const lines: number[] = []
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number
      const last = state.doc.lineAt(range.to).number
      for (let n = first; n <= last; n += 1) if (!lines.includes(n)) lines.push(n)
    }
    const allPrefixed = lines.every((n) => state.doc.line(n).text.trimStart().startsWith(prefix))
    const changes = lines.map((n) => {
      const line = state.doc.line(n)
      const indent = line.text.length - line.text.trimStart().length
      return allPrefixed
        ? { from: line.from + indent, to: line.from + indent + prefix.length, insert: '' }
        : { from: line.from + indent, insert: prefix }
    })
    dispatch(state.update({ changes, userEvent: 'input.format' }))
    return true
  }
}

export const toggleBlockquote = toggleLinePrefix('> ')
export const toggleBulletList = toggleLinePrefix('- ')

export const toggleOrderedList: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()
  let index = 1
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n += 1) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const existing = /^\s*\d+\.\s+/.exec(line.text)
      changes.push({
        from: line.from,
        to: line.from + (existing?.[0].length ?? 0),
        insert: existing ? '' : `${index}. `,
      })
      index += 1
    }
  }
  dispatch(state.update({ changes, userEvent: 'input.format' }))
  return true
}

export const insertLink: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange((range) => {
        if (range.empty) {
          return {
            changes: { from: range.from, insert: '[]()' },
            range: EditorSelection.cursor(range.from + 1),
          }
        }
        const text = state.doc.sliceString(range.from, range.to)
        return {
          changes: { from: range.from, to: range.to, insert: `[${text}]()` },
          // Caret lands between the parens, ready for the URL.
          range: EditorSelection.cursor(range.from + text.length + 3),
        }
      }),
      { userEvent: 'input.format' },
    ),
  )
  return true
}

export const insertHorizontalRule: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from)
        const insert = line.text.trim() === '' ? '---\n' : '\n\n---\n\n'
        return {
          changes: { from: range.from, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        }
      }),
      { userEvent: 'input.format' },
    ),
  )
  return true
}

export const insertCodeBlock: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const text = state.doc.sliceString(range.from, range.to)
        const insert = '```\n' + text + '\n```'
        return {
          changes: { from: range.from, to: range.to, insert },
          // Caret on the language slot of the opening fence.
          range: EditorSelection.cursor(range.from + 3),
        }
      }),
      { userEvent: 'input.format' },
    ),
  )
  return true
}
