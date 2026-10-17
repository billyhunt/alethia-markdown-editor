import { useEffect } from 'react'
import { api } from '../api.ts'
import { dispatchHostCommand } from '../services/commandDispatcher.ts'
import { handleFileChange } from '../services/externalChanges.ts'
import {
  adoptFolder,
  ensureClosable,
  openPath,
  openRouted,
  refreshRecentFolders,
} from '../services/fileOps.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { editorController } from '../editor/editorController.ts'
// Bundled rather than fetched: the renderer's CSP has connect-src 'none', so
// a fetch of the file beside index.html is refused in a built app.
import welcomeText from '../content/welcome.md?raw'

/**
 * Subscribes to every main -> renderer event exactly once, then tells main the
 * renderer is listening -- which is what releases any queued "open with" paths.
 */
export function useHostEvents(): void {
  useEffect(() => {
    const unsubscribes = [
      api.on.command(dispatchHostCommand),
      api.on.fileChanged((event) => {
        void handleFileChange(event)
      }),
      api.on.folderTree((tree) => useWorkspaceStore.getState().setFolder(tree)),
      api.on.openPath((event) => void openRouted(event)),
      api.on.closeRequested(() => {
        void ensureClosable().then((closable) => {
          if (closable) void api.window.close({ force: true })
          else void api.window.cancelClose()
        })
      }),
      api.on.fullScreenChanged((isFullScreen) => {
        document.body.classList.toggle('is-fullscreen', isFullScreen)
      }),
      // Another window opening a folder changes this one's switcher too.
      api.on.recentFoldersChanged((folders) =>
        useWorkspaceStore.getState().setRecentFolders(folders),
      ),
    ]

    void api.app.rendererReady().then(async (ready) => {
      const workspace = useWorkspaceStore.getState()
      workspace.setSidebarVisible(ready.settings.sidebar.visible)
      workspace.setSidebarWidth(ready.settings.sidebar.width)
      workspace.setToolbarVisible(ready.settings.toolbarVisible)
      workspace.setAutosave(ready.settings.autosave)
      // Deliberately not awaited: it stats every remembered folder, and one
      // of them on a sleeping network share must not hold up restoring the
      // document this window was showing.
      void refreshRecentFolders()

      // A path handed to us by Finder or argv wins over restoring last session.
      // This window's own session, rather than one application-wide pair.
      const { session } = ready
      const pending = ready.pendingPaths

      if (pending.length > 0) {
        // Main only routes opens to a window with no session of its own, so
        // there is nothing to restore alongside them.
        for (const entry of pending) {
          if (entry.kind === 'dir') await adoptFolder(entry.path)
          else await openPath(entry.path, { preferDocument: true, routed: true })
        }
        await api.window.settleOpen()
        return
      }

      if (session.folder) await adoptFolder(session.folder)

      if (session.file) {
        const stat = await api.fs.stat(session.file).catch(() => null)
        // Main restored this window for this file; another window showing it
        // is not a reason to give it up.
        if (stat) await openPath(session.file, { routed: true })
        if (useDocumentStore.getState().filePath === session.file) return
        // Main still believes this window shows the file it could not open;
        // without this it would route that path here and never count it as
        // empty.
        await api.document.unwatch()
      }

      // Nothing to restore: show the bundled tour as an unsaved document, so a
      // first launch lands on something rather than an empty window.
      showWelcomeDocument()
    })

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [])
}

function showWelcomeDocument(): void {
  editorController.setDocument(welcomeText)
  // Left untitled deliberately: Save prompts for a location rather than
  // writing back into the app bundle. It is also not auto-named -- the tour
  // is the app's text, not a document the user started.
  useDocumentStore
    .getState()
    .load({ filePath: null, text: welcomeText, mtimeMs: null, autoNameable: false })
}

/** Mirrors document identity and dirty state into the native title bar. */
export function useDocumentTitle(): void {
  const filePath = useDocumentStore((state) => state.filePath)
  const dirty = useDocumentStore((state) => state.dirty)

  useEffect(() => {
    void api.window.setDocument({ filePath, edited: dirty })
  }, [filePath, dirty])
}
