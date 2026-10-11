import { useEffect } from 'react'
import { api, unwrapIpcError } from '../api.ts'
import { adoptFolder, openPath } from '../services/fileOps.ts'
import { clearDragOut, isOwnDragOut } from '../services/dragOut.ts'

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
      // A sidebar row let go of over the window is a drag that went nowhere.
      if (!path || isOwnDragOut(path)) return
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
    window.addEventListener('mousedown', clearDragOut)
    // Coming back after dropping elsewhere: the activating click never
    // reaches the page, so focus is the first sign the drag is over.
    window.addEventListener('focus', clearDragOut)
    return () => {
      window.removeEventListener('focus', clearDragOut)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('mousedown', clearDragOut)
    }
  }, [])
}
