import { redo, undo } from '@codemirror/commands'
import type { StateCommand } from '@codemirror/state'
import type { EditorCommand } from '../../shared/ipc.ts'
import {
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
} from './extensions/formatting.ts'

/** Maps the shared command vocabulary onto CodeMirror state commands. */
export const EDITOR_COMMANDS: Record<EditorCommand, StateCommand> = {
  undo,
  redo,
  bold: toggleBold,
  italic: toggleItalic,
  strikethrough: toggleStrikethrough,
  inlineCode: toggleInlineCode,
  link: insertLink,
  heading1: setHeading(1),
  heading2: setHeading(2),
  heading3: setHeading(3),
  heading4: setHeading(4),
  heading5: setHeading(5),
  heading6: setHeading(6),
  paragraph: setHeading(0),
  blockquote: toggleBlockquote,
  codeBlock: insertCodeBlock,
  bulletList: toggleBulletList,
  orderedList: toggleOrderedList,
  horizontalRule: insertHorizontalRule,
}
