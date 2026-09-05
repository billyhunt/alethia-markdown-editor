import { api } from '../api.ts'
import { editorController } from '../editor/editorController.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import type { FileChangeEvent } from '../../shared/api'

/**
 * A file changed underneath us. When there is nothing to lose we reload
 * silently (Typora's behaviour); when there is, the choice belongs to the user.
 */
export async function handleFileChange(event: FileChangeEvent): Promise<void> {
  const doc = useDocumentStore.getState()
  const workspace = useWorkspaceStore.getState()
  if (event.path !== doc.filePath) return

  if (event.kind === 'removed') {
    workspace.setNotice({
      message: 'This file was deleted or moved. Saving will recreate it.',
      actions: [{ label: 'Dismiss', run: () => workspace.setNotice(null) }],
    })
    // Nothing on disk to conflict with any more.
    doc.syncMtime(null)
    return
  }

  if (!doc.dirty) {
    const { content, mtimeMs } = await api.fs.readFile(event.path)
    editorController.setDocument(content)
    doc.load({ filePath: event.path, text: content, mtimeMs })
    workspace.setNotice({
      message: 'Reloaded from disk.',
      actions: [{ label: 'Dismiss', run: () => workspace.setNotice(null) }],
    })
    setTimeout(() => {
      const current = useWorkspaceStore.getState()
      if (current.notice?.message === 'Reloaded from disk.') current.setNotice(null)
    }, 2000)
    return
  }

  workspace.setNotice({
    message: 'This file has been changed on disk.',
    actions: [
      {
        label: 'Reload (discard my changes)',
        run: () => {
          void api.fs.readFile(event.path).then(({ content, mtimeMs }) => {
            editorController.setDocument(content)
            useDocumentStore.getState().load({ filePath: event.path, text: content, mtimeMs })
            useWorkspaceStore.getState().setNotice(null)
          })
        },
      },
      {
        label: 'Keep mine',
        run: () => {
          // Adopt the new mtime so the next save is not reported as a conflict.
          useDocumentStore.getState().syncMtime(event.mtimeMs)
          useWorkspaceStore.getState().setNotice(null)
        },
      },
    ],
  })
}
