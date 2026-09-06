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
  // The centred writing column.
  '.cm-scroller': {
    justifyContent: 'center',
    overflow: 'auto',
    fontFamily: 'var(--font-prose)',
    lineHeight: '1.65',
  },
  '.cm-content': {
    flex: '0 1 var(--md-column-width, 46rem)',
    maxWidth: '100%',
    padding: '2.5rem 2rem 30vh',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0' },
  // A blunt block caret rather than a hairline, to match the hard edges.
  '.cm-cursor, .cm-dropCursor': {
    borderLeft: '2px solid var(--accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-line.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85em',
  },
  // Search panel, squared off and hard-ruled like the rest of the chrome.
  '.cm-panels': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    border: 'none',
    borderBottom: 'var(--rule) solid var(--border)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
  },
  '.cm-panel input, .cm-panel button': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
    borderRadius: '0',
  },
  '.cm-panel input': {
    border: '2px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    padding: '2px 6px',
  },
})

/**
 * Token colours for fenced code. The code well is solid black in both themes,
 * so this is a single light-on-dark set rather than a per-theme pair.
 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--code-comment)',
    fontStyle: 'italic',
  },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--code-number)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--code-function)',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--code-operator)' },
  { tag: tags.propertyName, color: 'var(--code-property)' },
  { tag: tags.variableName, color: 'var(--code-fg)' },
  // Markdown's own syntax marks (a heading's `#`, emphasis asterisks) carry
  // these tags and are revealed at the caret ON PAPER, not in the code well --
  // so they take a paper-safe muted colour rather than the light-on-dark set.
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--text-muted)' },
])
