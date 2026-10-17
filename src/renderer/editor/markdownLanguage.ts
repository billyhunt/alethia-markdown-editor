import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Prec } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { mathExtension } from './extensions/lezer/math.ts'
import { frontMatterExtension } from './extensions/lezer/frontMatter.ts'

/**
 * Enter continues lists and quotes; Backspace removes their markup. Enter on
 * an empty item always ends the list -- by default CodeMirror instead turns a
 * one-item list into a loose one on the second Enter, which reads as the
 * list refusing to end.
 */
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })

/**
 * Declines with several cursors: each range renumbers the rest of its list
 * independently, so two empty items removed at once yield overlapping
 * replacements that merge into corrupt numbers (`44. five`). The generic
 * Enter binding handles multi-cursor presses instead.
 */
const listEnter = (view: EditorView): boolean =>
  view.state.selection.ranges.length === 1 && continueMarkup(view)

const listKeymap = Prec.high(
  keymap.of([
    { key: 'Enter', run: listEnter },
    { key: 'Backspace', run: deleteMarkupBackward },
  ]),
)

/**
 * `markdownLanguage` rather than the default CommonMark base, so GFM is on:
 * tables, task lists, strikethrough and autolinks.
 *
 * `codeLanguages` lazily loads a grammar per fenced block, which is what gives
 * syntax highlighting inside ```ts / ```python without bundling every mode.
 */
export const markdownExtension = [
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [mathExtension, frontMatterExtension],
    addKeymap: false,
  }),
  listKeymap,
]
