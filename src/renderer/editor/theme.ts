import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * Structural CodeMirror styling lives here rather than in a .css file:
 * CodeMirror injects its base theme after Vite's stylesheet, so equal-
 * specificity rules in plain CSS would lose. Values are CSS variables so a
 * single theme serves both light and dark.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
  },
  '&.cm-focused': { outline: 'none' },
  // The centered writing column -- the signature Typora layout.
  '.cm-scroller': {
    justifyContent: 'center',
    overflow: 'auto',
    fontFamily: 'var(--font-prose)',
    lineHeight: '1.7',
  },
  '.cm-content': {
    flex: '0 1 var(--md-column-width, 46rem)',
    maxWidth: '100%',
    padding: '3rem 2rem 30vh',
    caretColor: 'var(--text)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-line.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    border: 'none',
    borderBottom: '1px solid var(--border)',
  },
  '.cm-panel input, .cm-panel button': { fontFamily: 'var(--font-prose)' },
})

/** Token colours for fenced code blocks; every value is a CSS variable. */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--code-operator)' },
  { tag: tags.propertyName, color: 'var(--code-property)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--code-meta)' },
  { tag: tags.variableName, color: 'var(--text)' },
])
