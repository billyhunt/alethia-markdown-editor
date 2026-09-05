import { api, unwrapIpcError } from '../api.ts'
import { editorController } from '../editor/editorController.ts'
import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'

/**
 * Every destructive transition funnels through here. Main never caches the
 * dirty flag -- it asks the renderer, which reads the store synchronously, so
 * a keystroke immediately before Cmd+W cannot race the check.
 */
export async function ensureClosable(): Promise<boolean> {
  const { dirty, filePath } = useDocumentStore.getState()
  if (!dirty) return true

  const choice = await api.dialog.confirmSaveChanges({ fileName: documentName(filePath) })
  if (choice === 'cancel') return false
  if (choice === 'dontSave') return true
  return save()
}

async function adoptFile(filePath: string): Promise<void> {
  const { content, mtimeMs } = await api.fs.readFile(filePath)
  editorController.setDocument(content)
  useDocumentStore.getState().load({ filePath, text: content, mtimeMs })
  await api.recents.add(filePath)
  await api.document.watch(filePath)
  useWorkspaceStore.getState().setNotice(null)
}

export async function newDocument(): Promise<void> {
  if (!(await ensureClosable())) return
  editorController.setDocument('')
  useDocumentStore.getState().load({ filePath: null, text: '', mtimeMs: null })
  await api.document.unwatch()
  useWorkspaceStore.getState().setNotice(null)
}

export async function openPath(filePath: string): Promise<void> {
  if (!(await ensureClosable())) return
  try {
    await adoptFile(filePath)
  } catch (error) {
    await api.dialog.showError({ title: 'Could not open file', message: unwrapIpcError(error) })
  }
}

export async function openFileDialog(): Promise<void> {
  if (!(await ensureClosable())) return
  const chosen = await api.dialog.openFile()
  if (chosen) await openPath(chosen)
}

export async function openFolderDialog(): Promise<void> {
  const chosen = await api.dialog.openFolder()
  if (chosen) await adoptFolder(chosen)
}

export async function adoptFolder(root: string): Promise<void> {
  try {
    const folder = await api.folder.list(root)
    useWorkspaceStore.getState().setFolder(folder)
    await api.folder.watch(root)
  } catch (error) {
    await api.dialog.showError({ title: 'Could not open folder', message: unwrapIpcError(error) })
  }
}

export async function save(): Promise<boolean> {
  const { filePath, mtimeMs } = useDocumentStore.getState()
  if (!filePath) return saveAs()
  return writeTo(filePath, mtimeMs)
}

export async function saveAs(): Promise<boolean> {
  const { filePath } = useDocumentStore.getState()
  const chosen = await api.dialog.saveAs({
    suggestedName: filePath ? documentName(filePath) : 'Untitled.md',
    defaultDir: useWorkspaceStore.getState().folderRoot,
  })
  if (!chosen) return false
  // A brand new path has nothing to conflict with.
  return writeTo(chosen, null)
}

async function writeTo(filePath: string, expectedMtimeMs: number | null): Promise<boolean> {
  const text = editorController.getText()
  try {
    const result = await api.fs.writeFile(filePath, text, { expectedMtimeMs })
    if (!result.ok) {
      showConflictNotice(filePath, text)
      return false
    }
    useDocumentStore.getState().markSaved({ filePath, text, mtimeMs: result.mtimeMs })
    await api.recents.add(filePath)
    await api.document.watch(filePath)
    return true
  } catch (error) {
    await api.dialog.showError({ title: 'Could not save file', message: unwrapIpcError(error) })
    return false
  }
}

function showConflictNotice(filePath: string, text: string): void {
  useWorkspaceStore.getState().setNotice({
    message: 'This file changed on disk since you loaded it.',
    actions: [
      {
        label: 'Overwrite',
        run: () => {
          void api.fs.writeFile(filePath, text, { force: true }).then((result) => {
            if (result.ok) {
              useDocumentStore.getState().markSaved({ filePath, text, mtimeMs: result.mtimeMs })
            }
            useWorkspaceStore.getState().setNotice(null)
          })
        },
      },
      {
        label: 'Reload from disk',
        run: () => {
          void adoptFile(filePath)
        },
      },
    ],
  })
}

export async function closeDocument(): Promise<void> {
  if (!(await ensureClosable())) return
  // Closing a file keeps the workspace: the folder is the context, not the doc.
  editorController.setDocument('')
  useDocumentStore.getState().load({ filePath: null, text: '', mtimeMs: null })
  await api.document.unwatch()
}

export async function revealInFinder(): Promise<void> {
  const { filePath } = useDocumentStore.getState()
  if (filePath) await api.shell.showItemInFolder(filePath)
}
