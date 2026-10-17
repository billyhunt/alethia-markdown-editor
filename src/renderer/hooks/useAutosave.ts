import { useEffect } from 'react'
import { editorController } from '../editor/editorController.ts'
import {
  autoFileRetryable,
  autoNamePending,
  save,
  saveNewByTitle,
  syncAutoName,
} from '../services/fileOps.ts'
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
        if (!autosave) return
        // A save already in flight can take a while -- creating a file and
        // relisting a large folder -- so come back rather than dropping this
        // pass, which would otherwise leave the last edits unwritten until
        // the next keystroke.
        if (running) {
          schedule()
          return
        }
        const { dirty, filePath, namedByTitle } = useDocumentStore.getState()
        // A clean document can still owe a rename: a title typed while an
        // earlier rename was in flight is saved by the pass that follows it,
        // which clears the flag this check used to rely on alone.
        if (!dirty && !autoNamePending()) return
        const attemptedText = editorController.getText()
        running = true
        void (async () => {
          if (!filePath) {
            await saveNewByTitle()
            return
          }
          // Rename before writing, so the save lands on the current name.
          if (namedByTitle) await syncAutoName()
          // Read again: typing during the rename may have changed it.
          if (useDocumentStore.getState().dirty) await save()
        })().finally(() => {
          running = false
          const current = useDocumentStore.getState()
          const typedDuring = editorController.getText() !== attemptedText
          const owesWork = (current.dirty && current.filePath !== null) || autoNamePending()
          // A buffer that could not be filed is tried again by itself, a few
          // times: the disk may only have been briefly full or busy, and the
          // user may have stopped typing.
          if ((typedDuring && owesWork) || autoFileRetryable()) schedule()
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
