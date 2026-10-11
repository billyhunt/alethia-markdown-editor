import { api, unwrapIpcError } from '../api.ts'
import { editorController } from '../editor/editorController.ts'
import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import type { OpenPathEvent } from '../../shared/api.ts'

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

/**
 * True when the buffer differs from what was loaded or last saved. Read from
 * the editor itself, because the dirty flag in the store is debounced.
 */
export function hasUnsavedEdits(): boolean {
  return editorController.getText() !== useDocumentStore.getState().savedText
}

async function adoptFile(filePath: string): Promise<void> {
  const { content, mtimeMs, lineEnding } = await api.fs.readFile(filePath)
  editorController.setDocument(content)
  useDocumentStore.getState().load({ filePath, text: content, mtimeMs, lineEnding })
  editorController.refreshPreview()
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

interface OpenPathOptions {
  /** A file chosen directly should take the whole window unless a workspace is already open. */
  preferDocument?: boolean
  /**
   * Main already chose this window for the file (Finder, argv, a second
   * launch), having checked every other window first.
   */
  routed?: boolean
}

export async function openPath(
  filePath: string,
  { preferDocument = false, routed = false }: OpenPathOptions = {},
): Promise<void> {
  // One document, one window: two editors on the same file would autosave
  // over each other. Checked before the save prompt, which would otherwise
  // ask about this window's document for nothing.
  if (!routed && (await api.window.revealDocument(filePath).catch(() => false))) return
  if (!(await ensureClosable())) return
  try {
    await adoptFile(filePath)
    if (preferDocument && !useWorkspaceStore.getState().folderRoot) {
      // This is transient; a direct-open must not overwrite the user's global
      // sidebar preference, and the toggle remains one click away.
      useWorkspaceStore.getState().setSidebarVisible(false)
    }
  } catch (error) {
    await api.dialog.showError({ title: 'Could not open file', message: unwrapIpcError(error) })
  }
}

/**
 * Handles a file or folder main routed to this window (Finder, argv, a second
 * launch). Main chose this window because it looked empty; if the user has
 * typed into it since main last heard, the file is passed back to be opened
 * elsewhere, so it never costs them a save prompt or the text they were
 * writing.
 */
export async function openRouted(event: OpenPathEvent): Promise<void> {
  if (event.kind === 'file' && hasUnsavedEdits()) {
    try {
      await api.window.rerouteOpen(event.path)
    } catch (error) {
      await api.dialog.showError({ title: 'Could not open file', message: unwrapIpcError(error) })
    }
    return
  }
  try {
    if (event.kind === 'dir') await adoptFolder(event.path)
    else await openPath(event.path, { preferDocument: true, routed: true })
  } finally {
    await api.window.settleOpen()
  }
}

export async function openFileDialog(): Promise<void> {
  const chosen = await api.dialog.openFile()
  if (chosen) await openPath(chosen, { preferDocument: true })
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
  const { lineEnding } = useDocumentStore.getState()
  try {
    const result = await api.fs.writeFile(filePath, text, { expectedMtimeMs, lineEnding })
    if (!result.ok) {
      showConflictNotice(filePath, text)
      return false
    }
    useDocumentStore.getState().markSaved({ filePath, text, mtimeMs: result.mtimeMs })
    editorController.refreshPreview()
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
  // retained text as saved when its file no longer exists.
  doc.load({ filePath: null, text: '', mtimeMs: null, lineEnding: doc.lineEnding })
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
      const doc = useDocumentStore.getState()
      doc.load({ filePath: next, text: doc.savedText, mtimeMs: doc.mtimeMs })
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
