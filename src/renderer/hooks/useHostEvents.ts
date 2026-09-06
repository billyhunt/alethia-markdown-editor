import { useEffect } from 'react'
import { api } from '../api.ts'
import { dispatchHostCommand } from '../services/commandDispatcher.ts'
import { handleFileChange } from '../services/externalChanges.ts'
import { adoptFolder, ensureClosable, openPath } from '../services/fileOps.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { editorController } from '../editor/editorController.ts'

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
      api.on.openPath((event) => {
        if (event.kind === 'dir') void adoptFolder(event.path)
        else void openPath(event.path)
      }),
      api.on.closeRequested(() => {
        void ensureClosable().then((closable) => {
          if (closable) void api.window.close({ force: true })
          else void api.window.cancelClose()
        })
      }),
      api.on.fullScreenChanged((isFullScreen) => {
        document.body.classList.toggle('is-fullscreen', isFullScreen)
      }),
    ]

    void api.app.rendererReady().then(async (ready) => {
      const workspace = useWorkspaceStore.getState()
      workspace.setSidebarVisible(ready.settings.sidebar.visible)
      workspace.setSidebarWidth(ready.settings.sidebar.width)
      workspace.setToolbarVisible(ready.settings.toolbarVisible)
      workspace.setAutosave(ready.settings.autosave)

      // A path handed to us by Finder or argv wins over restoring last session.
      // This window's own session, rather than one application-wide pair.
      const { session } = ready
      const pending = ready.pendingPaths

      if (pending.length > 0) {
        // Restore the workspace first, so a file opened from Finder arrives
        // with a populated sidebar rather than an empty one.
        if (session.folder) await adoptFolder(session.folder)
        for (const entry of pending) {
          if (entry.kind === 'dir') await adoptFolder(entry.path)
          else await openPath(entry.path)
        }
        return
      }

      if (session.folder) await adoptFolder(session.folder)

      if (session.file) {
        const stat = await api.fs.stat(session.file).catch(() => null)
        if (stat) {
          await openPath(session.file)
          return
        }
      }

      // Nothing to restore: show the bundled tour as an unsaved document, so a
      // first launch lands on something rather than an empty window.
      await showWelcomeDocument()
    })

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [])
}

async function showWelcomeDocument(): Promise<void> {
  try {
    const response = await fetch('./sample.md')
    if (!response.ok) return
    const text = await response.text()
    editorController.setDocument(text)
    // Left untitled deliberately: Save prompts for a location rather than
    // writing back into the app bundle.
    useDocumentStore.getState().load({ filePath: null, text, mtimeMs: null })
  } catch {
    /* an empty editor is an acceptable fallback */
  }
}

/** Mirrors document identity and dirty state into the native title bar. */
export function useDocumentTitle(): void {
  const filePath = useDocumentStore((state) => state.filePath)
  const dirty = useDocumentStore((state) => state.dirty)

  useEffect(() => {
    void api.window.setDocument({ filePath, edited: dirty })
  }, [filePath, dirty])
}
