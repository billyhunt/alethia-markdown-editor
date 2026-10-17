import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { api } from '../../api.ts'
import { useDocumentStore } from '../../state/documentStore.ts'

/**
 * Cmd/Ctrl-click opens a rendered link externally. A plain click is left alone
 * so it places the caret and reveals the link's source instead.
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
      if (href.startsWith('#')) return false
      event.preventDefault()
      if (/^https?:\/\//i.test(href)) {
        void api.shell.openExternal(href).catch(() => undefined)
      } else if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
        return false
      } else {
        const documentId = useDocumentStore.getState().documentId
        if (documentId) void api.app.openLinkedFile(href, documentId).catch((error) =>
          api.dialog.showError({ title: 'Could not open linked file', message: String(error) }),
        )
      }
      return true
    },
  }),
  // Signals that Cmd is held, so the link shows a pointer rather than a caret.
  EditorView.theme({
    '.cm-md-link': { cursor: 'text' },
    '&.cm-mod-down .cm-md-link': { cursor: 'pointer' },
  }),
]
