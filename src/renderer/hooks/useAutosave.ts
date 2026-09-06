import { useEffect } from 'react'
import { editorController } from '../editor/editorController.ts'
import { save } from '../services/fileOps.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'

/** How long typing must pause before the document is written. */
const IDLE_MS = 2000

/**
 * Saves the open document once typing settles.
 *
 * Only ever touches a document that already has a path: an untitled buffer
 * would need a Save As dialog, and throwing one of those at someone
 * mid-sentence is worse than leaving it unsaved.
 *
 * Every write snapshots what it replaces, so nothing autosave does is
 * unrecoverable -- that is what makes saving without being asked defensible.
 */
export function useAutosave(): void {
  useEffect(() => {
    let timer: number | undefined
    let running = false

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const { autosave } = useWorkspaceStore.getState()
        const { dirty, filePath } = useDocumentStore.getState()
        if (!autosave || !dirty || !filePath || running) return
        running = true
        void save().finally(() => {
          running = false
        })
      }, IDLE_MS)
    }

    const unsubscribe = editorController.onDocChange(schedule)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}
