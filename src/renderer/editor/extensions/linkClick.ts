import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { api } from '../../api.ts'

/**
 * Cmd/Ctrl-click opens a rendered link externally. A plain click is left alone
 * so it places the caret and reveals the link's source, as Typora does.
 *
 * The URL is opened through main, which refuses anything that is not http(s);
 * the renderer never navigates itself.
 */
export const linkClick = (): Extension => [
  EditorView.domEventHandlers({
    mousedown(event) {
      if (!event.metaKey && !event.ctrlKey) return false
      const target = event.target as HTMLElement | null
      const href = target?.closest<HTMLElement>('.cm-md-link')?.dataset.href
      if (!href) return false
      event.preventDefault()
      void api.shell.openExternal(href).catch(() => undefined)
      return true
    },
  }),
  // Signals that Cmd is held, so the link shows a pointer rather than a caret.
  EditorView.theme({
    '.cm-md-link': { cursor: 'text' },
    '&.cm-mod-down .cm-md-link': { cursor: 'pointer' },
  }),
]
