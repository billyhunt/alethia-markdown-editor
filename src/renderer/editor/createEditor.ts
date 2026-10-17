import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, keymap, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { syntaxHighlighting } from '@codemirror/language'
import { markdownExtension } from './markdownLanguage.ts'
import { codeHighlightStyle, editorTheme } from './theme.ts'
import { livePreview } from './extensions/index.ts'
import { documentPathExtension } from './extensions/documentPath.ts'
import { pasteMarkdown } from './extensions/pasteMarkdown.ts'

export interface EditorStateOptions {
  /** Where the document lives, for resolving relative image sources. */
  filePath?: string | null
}

export function createEditorState(
  doc: string,
  extra: Extension = [],
  options: EditorStateOptions = {},
): EditorState {
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
      documentPathExtension(options.filePath ?? null),
      livePreview(),
      pasteMarkdown,
      // markdownExtension carries the list keys at high precedence (Enter
      // continues lists, Backspace removes markup), so they are not
      // repeated here.
      keymap.of([...closeBracketsKeymap, ...searchKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
      }),
      // A file dropped on the editor opens, via the window's drop handler.
      // CodeMirror would also paste the file's text in at the drop point,
      // leaving the current document edited by accident.
      EditorView.domEventHandlers({
        drop: (event) => (event.dataTransfer?.files.length ?? 0) > 0,
      }),
      editorTheme,
      extra,
    ],
  })
}
