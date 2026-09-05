import { useEffect } from 'react'
import { api, unwrapIpcError } from '../api.ts'
import { adoptFolder, openPath } from '../services/fileOps.ts'

/**
 * Dropping a file on the window would otherwise make Chromium navigate to
 * file:// and destroy the app -- main blocks that, and we handle the drop here.
 */
export function useDropFiles(): void {
  useEffect(() => {
    const onDragOver = (event: DragEvent) => event.preventDefault()

    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      const file = event.dataTransfer?.files[0]
      if (!file) return
      // File.path was removed from Electron; the path comes from the preload.
      const path = api.getPathForFile(file)
      if (!path) return
      void api.app
        .grantDroppedPath(path)
        .then((entry) => (entry.kind === 'dir' ? adoptFolder(entry.path) : openPath(entry.path)))
        .catch((error: unknown) =>
          api.dialog.showError({
            title: 'Could not open that file',
            message: unwrapIpcError(error),
          }),
        )
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}
