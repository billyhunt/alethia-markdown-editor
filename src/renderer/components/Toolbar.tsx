import { editorController } from '../editor/editorController.ts'
import type { EditorCommand } from '../../shared/ipc.ts'

interface Tool {
  command: EditorCommand
  label: string
  title: string
  /** Rendered in the display face, so B reads as bold and I as italic. */
  style?: React.CSSProperties
}

// Grouped the way the Format menu is, with a rule between groups.
const GROUPS: Tool[][] = [
  [
    { command: 'heading1', label: 'H1', title: 'Heading 1  ⌘1' },
    { command: 'heading2', label: 'H2', title: 'Heading 2  ⌘2' },
    { command: 'heading3', label: 'H3', title: 'Heading 3  ⌘3' },
    { command: 'paragraph', label: '¶', title: 'Paragraph  ⌘0' },
  ],
  [
    {
      command: 'bold',
      label: 'B',
      title: 'Bold  ⌘B',
      style: { fontFamily: 'var(--font-display)' },
    },
    {
      command: 'italic',
      label: 'I',
      title: 'Italic  ⌘I',
      style: { fontStyle: 'italic', fontWeight: 600 },
    },
    {
      command: 'strikethrough',
      label: 'S',
      title: 'Strikethrough  ⌃⇧X',
      style: { textDecoration: 'line-through' },
    },
    { command: 'inlineCode', label: '`', title: 'Inline code  ⌘E' },
  ],
  [
    { command: 'link', label: 'LINK', title: 'Link  ⌘K' },
    { command: 'blockquote', label: 'QUOTE', title: 'Quote  ⌘⇧Q' },
    { command: 'codeBlock', label: 'BLOCK', title: 'Code block  ⌘⇧K' },
  ],
  [
    { command: 'bulletList', label: 'LIST', title: 'Bullet list  ⌘⇧U' },
    { command: 'orderedList', label: '1.', title: 'Ordered list  ⌘⇧L' },
    { command: 'horizontalRule', label: '—', title: 'Horizontal rule' },
  ],
]

export default function Toolbar() {
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {GROUPS.map((group, index) => (
        <div className="toolbar-group" key={group[0].command}>
          {index > 0 && <span className="toolbar-rule" aria-hidden="true" />}
          {group.map((tool) => (
            <button
              key={tool.command}
              type="button"
              className="toolbar-button"
              style={tool.style}
              title={tool.title}
              aria-label={tool.title}
              // Without this the button takes focus on press and the command
              // runs with no caret to act on.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editorController.exec(tool.command)}
            >
              {tool.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
