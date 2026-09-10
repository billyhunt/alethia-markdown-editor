import { useEffect } from 'react'
import { editorController } from '../editor/editorController.ts'
import { save, saveNewByTitle, syncAutoName } from '../services/fileOps.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'

/** How long typing must pause before the document is written. */
const IDLE_MS = 2000

/**
 * Saves the open document once typing settles.
 *
 * A buffer with no path is not left unsaved: it is filed under its own title
 * (its first heading, or its first line) in the open folder, so starting to
 * write is enough to have a real file. No dialog appears, because a Save As
 * sheet thrown at someone mid-sentence is the thing worth avoiding -- not the
 * saving.
 *
 * While that name was chosen for the user, later saves keep the file in step
 * with the title. Renaming it, or using Save As, hands naming back to them
 * and this stops.
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
        const { dirty, filePath, namedByTitle } = useDocumentStore.getState()
        // A save already in flight can take a while -- creating a file and
        // relisting a large folder -- so come back rather than dropping this
        // pass, which would otherwise leave the last edits unwritten until
        // the next keystroke.
        if (running) {
          schedule()
          return
        }
        if (!autosave || !dirty) return
        running = true
        void (async () => {
          if (!filePath) {
            await saveNewByTitle()
            return
          }
          // Rename before writing, so the save lands on the current name.
          if (namedByTitle) await syncAutoName()
          await save()
        })().finally(() => {
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
