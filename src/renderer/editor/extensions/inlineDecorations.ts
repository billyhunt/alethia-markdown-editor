import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { isActive, lineIsActive } from './activeRanges.ts'
import { BulletWidget, CheckboxWidget, CodeFenceWidget, HrWidget } from '../widgets/index.ts'

/**
 * The live-preview engine for everything that fits on one line.
 *
 * Multi-line constructs (tables, block math) cannot live here: CodeMirror
 * forbids a ViewPlugin's decorations from changing line structure, so those
 * belong in a StateField instead.
 */

const hidden = Decoration.replace({})
const lineDeco = (cls: string) => Decoration.line({ class: cls })
const markClass = (cls: string) => Decoration.mark({ class: cls })

interface Built {
  decorations: Range<Decoration>[]
  /** Every replaced range, so arrow keys step over hidden text as one unit. */
  atomic: Range<Decoration>[]
}

function hide(built: Built, from: number, to: number): void {
  if (to <= from) return
  const range = hidden.range(from, to)
  built.decorations.push(range)
  built.atomic.push(range)
}

function replaceWith(built: Built, from: number, to: number, deco: Decoration): void {
  if (to < from) return
  const range = deco.range(from, to)
  built.decorations.push(range)
  built.atomic.push(range)
}

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) out.push(child)
  }
  return out
}

const firstNamed = (node: SyntaxNode, name: string): SyntaxNode | null =>
  childrenNamed(node, name)[0] ?? null

export function buildDecorations(view: EditorView): Built {
  const built: Built = { decorations: [], atomic: [] }
  const { state } = view
  const active = (from: number, to: number): boolean => isActive(state, from, to)
  const activeLine = (line: { from: number; to: number }): boolean =>
    lineIsActive(state, line as never)

  // Parse at least to the viewport edge so the visible region is never left as
  // raw text while lezer catches up in idle time.
  const tree = ensureSyntaxTree(state, view.viewport.to, 100) ?? syntaxTree(state)

  /** Wraps a node in a class and hides its delimiters when the caret is away. */
  const wrapped = (node: SyntaxNode, cls: string, markName: string): void => {
    built.decorations.push(markClass(cls).range(node.from, node.to))
    if (active(node.from, node.to)) return
    for (const mark of childrenNamed(node, markName)) hide(built, mark.from, mark.to)
  }

  const hideMarkerAndSpace = (from: number, to: number, lineEnd: number): void => {
    const next = to < lineEnd ? state.doc.sliceString(to, to + 1) : ''
    hide(built, from, next === ' ' ? Math.min(to + 1, lineEnd) : to)
  }

  // Lists are claimed innermost-first so a nested item's indentation is hidden
  // against its own content column rather than its ancestor's.
  const claimedLines = new Set<number>()

  for (const { from, to } of view.visibleRanges) {
    // --- pass 1: list structure -------------------------------------------
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name !== 'ListItem') return true
        const node = ref.node
        let depth = 0
        for (let p = node.parent; p; p = p.parent) if (p.name === 'ListItem') depth += 1

        const mark = firstNamed(node, 'ListMark')
        if (!mark) return true
        const markerLine = state.doc.lineAt(mark.from)
        const contentCol = mark.to + 1 - markerLine.from

        if (!claimedLines.has(markerLine.number)) {
          claimedLines.add(markerLine.number)
          built.decorations.push(
            Decoration.line({
              class: 'cm-md-li',
              attributes: { style: `--md-depth:${depth}` },
            }).range(markerLine.from),
          )
          // Leading indentation is always hidden -- it is layout, not content.
          hide(built, markerLine.from, mark.from)
        }

        // Continuation lines of the same item align with its text.
        const lastLine = state.doc.lineAt(node.to).number
        for (let n = markerLine.number + 1; n <= lastLine; n += 1) {
          if (claimedLines.has(n)) continue
          claimedLines.add(n)
          const line = state.doc.line(n)
          const leading = line.text.length - line.text.trimStart().length
          built.decorations.push(
            Decoration.line({
              class: 'cm-md-li',
              attributes: { style: `--md-depth:${depth}` },
            }).range(line.from),
          )
          hide(built, line.from, line.from + Math.min(contentCol, leading))
        }
        return true
      },
    })

    // --- pass 2: everything else ------------------------------------------
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const name = ref.name

        switch (name) {
          case 'HTMLBlock':
            return false

          case 'FencedCode': {
            const openLine = state.doc.lineAt(node.from)
            const closeLine = state.doc.lineAt(node.to)
            const blockActive = active(node.from, node.to)

            for (let n = openLine.number; n <= closeLine.number; n += 1) {
              const line = state.doc.line(n)
              const edge =
                n === openLine.number
                  ? ' cm-md-codeblock-first'
                  : n === closeLine.number
                    ? ' cm-md-codeblock-last'
                    : ''
              built.decorations.push(lineDeco(`cm-md-codeblock${edge}`).range(line.from))
            }

            if (!blockActive) {
              const info = firstNamed(node, 'CodeInfo')
              const language = info ? state.doc.sliceString(info.from, info.to) : 'plain'
              replaceWith(
                built,
                openLine.from,
                openLine.to,
                Decoration.replace({ widget: new CodeFenceWidget(language) }),
              )
              // Only collapse the closing fence when there is one; an unclosed
              // fence's "end" is just the end of the document.
              if (closeLine.number > openLine.number && closeLine.text.trim().startsWith('```')) {
                replaceWith(
                  built,
                  closeLine.from,
                  closeLine.to,
                  Decoration.replace({ widget: new CodeFenceWidget('') }),
                )
              }
            }
            // Never descend: a ```markdown fence gets a nested markdown tree
            // that would otherwise be live-previewed as if it were the document.
            return false
          }

          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            const level = Number(name.slice(-1))
            const line = state.doc.lineAt(node.from)
            built.decorations.push(lineDeco(`cm-md-heading cm-md-h${level}`).range(line.from))
            if (!activeLine(line)) {
              for (const mark of childrenNamed(node, 'HeaderMark')) {
                hideMarkerAndSpace(mark.from, mark.to, line.to)
              }
            }
            return true
          }

          case 'StrongEmphasis':
            wrapped(node, 'cm-md-strong', 'EmphasisMark')
            return true
          case 'Emphasis':
            wrapped(node, 'cm-md-em', 'EmphasisMark')
            return true
          case 'Strikethrough':
            wrapped(node, 'cm-md-strike', 'StrikethroughMark')
            return true
          case 'InlineCode':
            wrapped(node, 'cm-md-code', 'CodeMark')
            return true

          case 'Escape':
            if (!active(node.from, node.to)) hide(built, node.from, node.from + 1)
            return true

          case 'Link': {
            const url = firstNamed(node, 'URL')
            const href = url ? state.doc.sliceString(url.from, url.to) : ''
            built.decorations.push(
              Decoration.mark({
                class: 'cm-md-link',
                attributes: href ? { 'data-href': href } : {},
              }).range(node.from, node.to),
            )
            if (!active(node.from, node.to)) {
              for (const part of ['LinkMark', 'URL', 'LinkTitle', 'LinkLabel']) {
                for (const child of childrenNamed(node, part)) hide(built, child.from, child.to)
              }
            }
            return true
          }

          case 'URL': {
            // A bare autolinked URL, not the target inside a [text](url).
            const parent = node.parent?.name
            if (parent === 'Link' || parent === 'Image' || parent === 'Autolink') return true
            built.decorations.push(
              Decoration.mark({
                class: 'cm-md-link',
                attributes: { 'data-href': state.doc.sliceString(node.from, node.to) },
              }).range(node.from, node.to),
            )
            return true
          }

          case 'HorizontalRule': {
            const line = state.doc.lineAt(node.from)
            if (!activeLine(line)) {
              replaceWith(built, line.from, line.to, Decoration.replace({ widget: new HrWidget() }))
            }
            return true
          }

          case 'Blockquote': {
            const firstLine = state.doc.lineAt(node.from).number
            const lastLine = state.doc.lineAt(node.to).number
            for (let n = firstLine; n <= lastLine; n += 1) {
              built.decorations.push(lineDeco('cm-md-quote').range(state.doc.line(n).from))
            }
            // The `>` is never revealed -- Typora never shows it, and Enter
            // and Backspace already maintain the quote via markdownKeymap.
            for (const mark of childrenNamed(node, 'QuoteMark')) {
              const line = state.doc.lineAt(mark.from)
              hideMarkerAndSpace(mark.from, mark.to, line.to)
            }
            return true
          }

          case 'ListMark': {
            const line = state.doc.lineAt(node.from)
            const text = state.doc.sliceString(node.from, node.to)
            if (/^[-*+]$/.test(text)) {
              let depth = 0
              for (let p = node.parent?.parent; p; p = p.parent) if (p.name === 'ListItem') depth += 1
              // Replaced even on the active line: typing "- " should become a
              // bullet immediately, as it does in Typora.
              replaceWith(
                built,
                node.from,
                Math.min(node.to + 1, line.to),
                Decoration.replace({ widget: new BulletWidget(depth) }),
              )
            } else {
              built.decorations.push(markClass('cm-md-ol-mark').range(node.from, node.to))
            }
            return true
          }

          case 'TaskMarker': {
            const checked = state.doc.sliceString(node.from, node.to).toLowerCase().includes('x')
            replaceWith(
              built,
              node.from,
              node.to,
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }),
            )
            if (checked) {
              built.decorations.push(
                lineDeco('cm-md-task-done').range(state.doc.lineAt(node.from).from),
              )
            }
            return true
          }

          default:
            return true
        }
      },
    })
  }

  return built
}

export const inlineDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atomic: DecorationSet

    constructor(view: EditorView) {
      const built = buildDecorations(view)
      // `true` sorts the ranges; hand-ordering a RangeSetBuilder is
      // error-prone once line, mark and replace decorations are mixed.
      this.decorations = Decoration.set(built.decorations, true)
      this.atomic = Decoration.set(built.atomic, true)
    }

    update(update: ViewUpdate) {
      // The tree check matters: lezer parses large documents incrementally in
      // idle time, and without it the bottom of a long file stays raw.
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState)
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        treeChanged
      ) {
        const built = buildDecorations(update.view)
        this.decorations = Decoration.set(built.decorations, true)
        this.atomic = Decoration.set(built.atomic, true)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
)
