import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { mathExtension } from './extensions/lezer/math.ts'
import { frontMatterExtension } from './extensions/lezer/frontMatter.ts'

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
  extensions: [mathExtension, frontMatterExtension],
})
