import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { mathExtension } from './extensions/lezer/math.ts'
import { frontMatterExtension } from './extensions/lezer/frontMatter.ts'

/**
 * Enter continues lists and quotes; Backspace removes their markup. Enter on
 * an empty item always ends the list -- by default CodeMirror instead turns a
 * one-item list into a loose one on the second Enter, which reads as the
 * list refusing to end.
 */
const listKeymap = Prec.high(
  keymap.of([
    { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
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
