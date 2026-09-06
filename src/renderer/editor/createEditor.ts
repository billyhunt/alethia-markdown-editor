import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, keymap, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { syntaxHighlighting } from '@codemirror/language'
import { markdownExtension } from './markdownLanguage.ts'
import { codeHighlightStyle, editorTheme } from './theme.ts'
import { livePreview } from './extensions/index.ts'

export function createEditorState(doc: string, extra: Extension = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      // rectangularSelection and Alt-click both produce multi-range
      // selections, which the state collapses to one without this facet.
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      markdownExtension,
      syntaxHighlighting(codeHighlightStyle),
      closeBrackets(),
      search({ top: true }),
      livePreview(),
      // markdown() already contributes markdownKeymap at high precedence
      // (Enter continues lists, Backspace removes markup), so it is not
      // repeated here.
      keymap.of([...closeBracketsKeymap, ...searchKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
      }),
      editorTheme,
      extra,
    ],
  })
}
