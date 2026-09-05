import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

/**
 * `markdownLanguage` rather than the default CommonMark base, so GFM is on:
 * tables, task lists, strikethrough and autolinks.
 *
 * `codeLanguages` lazily loads a grammar per fenced block, which is what gives
 * syntax highlighting inside ```ts / ```python without bundling every mode.
 */
export const markdownExtension = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
})
