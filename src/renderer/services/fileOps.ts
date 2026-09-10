import { api, unwrapIpcError } from '../api.ts'
import { fileNameForDocument } from '../../shared/titles.ts'
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
  const { content, mtimeMs, lineEnding } = await api.fs.readFile(filePath)
  editorController.setDocument(content)
  useDocumentStore.getState().load({ filePath, text: content, mtimeMs, lineEnding })
  await api.recents.add(filePath)
  await api.document.watch(filePath)
  useWorkspaceStore.getState().setNotice(null)

  // With no workspace yet, take the file's own folder. Otherwise opening a
  // note from Finder lands on a sidebar telling you to open a folder, which
  // reads as the app refusing to work until you do something.
  if (!useWorkspaceStore.getState().folderRoot) {
    const parent = filePath.slice(0, filePath.lastIndexOf('/'))
    if (parent) await adoptFolder(parent).catch(() => undefined)
  }
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
    // Every folder opened becomes somewhere to switch back to.
    await api.recents.addFolder(root)
    await refreshRecentFolders()
  } catch (error) {
    await api.dialog.showError({ title: 'Could not open folder', message: unwrapIpcError(error) })
  }
}

/** Reads the switcher list back from main, which prunes vanished folders. */
export async function refreshRecentFolders(): Promise<void> {
  const folders = await api.recents.listFolders().catch(() => [])
  useWorkspaceStore.getState().setRecentFolders(folders)
}

/**
 * The workspace switcher, in the vein of Obsidian's vault switcher: pick a
 * folder opened before, or open a new one.
 *
 * Switching replaces the sidebar's folder and leaves the open document
 * alone. A document is not owned by the workspace it was reached through,
 * and closing someone's file because they looked at another folder would be
 * a surprising thing to do with unsaved work.
 */
export async function switchFolder(): Promise<void> {
  const result = await api.menu.folderSwitcher({
    current: useWorkspaceStore.getState().folderRoot,
  })
  if (result.action === 'switch') await adoptFolder(result.path)
  else if (result.action === 'open') await openFolderDialog()
  else if (result.action === 'cleared') await refreshRecentFolders()
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
  // Naming it by hand ends the automatic naming: from here the file is the
  // user's to call whatever they like.
  return writeTo(chosen, null, false)
}

/**
 * Gives an untitled buffer a file of its own, named after its title, with no
 * dialog in the way.
 *
 * The file lands in the open folder, or in ~/Documents/Alethia when there is
 * no workspace. Nothing is overwritten -- main numbers the name if it is
 * taken -- and until the user renames or Save-As's it, the file keeps
 * following the title (see syncAutoName).
 *
 * Returns false when there is no title yet, which just means the next idle
 * pause tries again.
 */
export async function saveNewByTitle(): Promise<boolean> {
  const { filePath, autoNameable } = useDocumentStore.getState()
  if (filePath || !autoNameable) return false
  const name = fileNameForDocument(editorController.getText())
  if (!name) return false

  let created: string
  try {
    created = await api.fs.createFile({ dir: useWorkspaceStore.getState().folderRoot, name })
  } catch {
    // Saving on the user's behalf must never interrupt them. A failure here
    // leaves the buffer untitled, exactly as it was.
    return false
  }
  const saved = await writeTo(created, null, true)
  if (saved) await refreshFolder()
  return saved
}

/**
 * Keeps an automatically named file's name in step with its title, so a
 * heading finished after the first save is not left behind on disk.
 *
 * Best effort by design: a name already taken, or any other failure, simply
 * leaves the current name in place.
 */
export async function syncAutoName(): Promise<void> {
  const { namedByTitle, filePath } = useDocumentStore.getState()
  if (!namedByTitle || !filePath) return
  const wanted = fileNameForDocument(editorController.getText())
  if (!wanted || wanted === documentName(filePath)) return

  try {
    const next = await api.fs.rename(filePath, wanted)
    // Only the identity moved: the buffer, its dirty flag and its baseline
    // are unchanged, and the save that follows writes to the new path.
    useDocumentStore.getState().setPath(next, true)
    await api.recents.add(next)
    await api.document.watch(next)
    await refreshFolder()
  } catch {
    // Keep the name it has; the document is still saved either way.
  }
}

async function writeTo(
  filePath: string,
  expectedMtimeMs: number | null,
  namedByTitle?: boolean,
): Promise<boolean> {
  const text = editorController.getText()
  const { lineEnding } = useDocumentStore.getState()
  try {
    const result = await api.fs.writeFile(filePath, text, { expectedMtimeMs, lineEnding })
    if (!result.ok) {
      showConflictNotice(filePath, text)
      return false
    }
    useDocumentStore.getState().markSaved({ filePath, text, mtimeMs: result.mtimeMs, namedByTitle })
    await api.recents.add(filePath)
    await api.document.watch(filePath)
    useWorkspaceStore.getState().setNotice(null)
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
          const ending = useDocumentStore.getState().lineEnding
          void api.fs.writeFile(filePath, text, { force: true, lineEnding: ending }).then((result) => {
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

/** Re-lists the open workspace folder, e.g. after a rename or a trash. */
export async function refreshFolder(): Promise<void> {
  const root = useWorkspaceStore.getState().folderRoot
  if (!root) return
  try {
    useWorkspaceStore.getState().setFolder(await api.folder.list(root))
  } catch {
    // A folder that has gone away is not worth interrupting the user over.
  }
}

/**
 * An intentional trash closes a saved document. Only unsaved edits need to
 * survive as an untitled buffer; the saved copy is recoverable from Trash.
 */
export function forgetTrashedFile(filePath: string): void {
  const doc = useDocumentStore.getState()
  if (doc.filePath !== filePath) return
  const text = editorController.getText()
  // Compare the actual buffer: the dirty indicator may still be debouncing.
  const keepEdits = text.length > 0 && text !== doc.savedText
  if (!keepEdits) editorController.setDocument('')
  // An untitled buffer's baseline is empty, so undoing an edit cannot mark
  // retained text as saved when its file no longer exists. These edits are
  // never filed automatically: re-creating what was just sent to the Trash,
  // under nearly the same name, is the opposite of what was asked for.
  doc.load({
    filePath: null,
    text: '',
    mtimeMs: null,
    lineEnding: doc.lineEnding,
    autoNameable: false,
  })
  doc.setDirty(keepEdits)
  void api.document.unwatch()
  useWorkspaceStore.getState().setNotice({
    message: keepEdits
      ? 'Moved to Trash. Your unsaved edits are still here. Use Save As to keep them.'
      : 'Moved to Trash.',
    actions: [
      ...(keepEdits ? [{ label: 'Save As', run: () => { void saveAs() } }] : []),
      { label: 'Dismiss', run: () => useWorkspaceStore.getState().setNotice(null) },
    ],
  })
}

export async function renameFile(filePath: string, name: string): Promise<void> {
  const wasOpen = useDocumentStore.getState().filePath === filePath
  try {
    const next = await api.fs.rename(filePath, name)
    if (wasOpen) {
      // Follow the file: the buffer is unchanged, only its identity moved.
      // A hand-picked name also ends automatic naming.
      useDocumentStore.getState().setPath(next, false)
      await api.recents.add(next)
      await api.document.watch(next)
    }
    await refreshFolder()
  } catch (error) {
    await api.dialog.showError({ title: 'Could not rename', message: unwrapIpcError(error) })
  }
}

export async function closeDocument(): Promise<void> {
  if (!(await ensureClosable())) return
  // Closing a file keeps the workspace: the folder is the context, not the doc.
  editorController.setDocument('')
  useDocumentStore.getState().load({ filePath: null, text: '', mtimeMs: null })
  await api.document.unwatch()
  useWorkspaceStore.getState().setNotice(null)
}

export async function exportPdf(): Promise<void> {
  const { filePath } = useDocumentStore.getState()
  try {
    const written = await api.print.exportPdf(documentName(filePath))
    if (written) {
      useWorkspaceStore.getState().setNotice({
        message: `Exported to ${written.split('/').pop() ?? 'PDF'}.`,
        actions: [
          {
            label: 'Reveal in Finder',
            run: () => {
              void api.shell.showItemInFolder(written)
              useWorkspaceStore.getState().setNotice(null)
            },
          },
          { label: 'Dismiss', run: () => useWorkspaceStore.getState().setNotice(null) },
        ],
      })
    }
  } catch (error) {
    await api.dialog.showError({ title: 'Could not export PDF', message: unwrapIpcError(error) })
  }
}

export async function revealInFinder(): Promise<void> {
  const { filePath } = useDocumentStore.getState()
  if (filePath) await api.shell.showItemInFolder(filePath)
}
