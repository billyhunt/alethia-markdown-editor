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
  const { content, mtimeMs, lineEnding } = await api.fs.readFile(filePath)
  // Main serves a document's images only while it has that document recorded
  // as open in this window, and `document.watch` is what records it. So it
  // goes before the editor learns the path: an image request that arrived
  // first would be refused as "not open", and the widget remembers a refusal
  // as a failed image.
  await api.document.watch(filePath)
  // Path next: the editor builds image URLs from it during setDocument, and
  // the store effect that would correct it runs a tick later. Without this,
  // opening B while A is open briefly requests B's images against A's folder.
  editorController.setFilePath(filePath)
  editorController.setDocument(content)
  useDocumentStore.getState().load({ filePath, text: content, mtimeMs, lineEnding })
  await api.recents.add(filePath)
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

interface ActiveWrite {
  queued: boolean
  promise: Promise<boolean>
}

const activeWrites = new Map<string, ActiveWrite>()

function writeTo(filePath: string, expectedMtimeMs: number | null): Promise<boolean> {
  const running = activeWrites.get(filePath)
  if (running) {
    running.queued = true
    return running.promise
  }

  const active: ActiveWrite = { queued: false, promise: Promise.resolve(false) }
  activeWrites.set(filePath, active)
  active.promise = (async () => {
    let result = false
    do {
      active.queued = false
      const attemptedText = editorController.getText()
      const current = useDocumentStore.getState()
      const expected = current.filePath === filePath ? current.mtimeMs : expectedMtimeMs
      result = await performWriteTo(filePath, expected)
      if (!active.queued || editorController.getText() === attemptedText) return result
    } while (useDocumentStore.getState().filePath === filePath)
    return result
  })().finally(() => {
    if (activeWrites.get(filePath) === active) activeWrites.delete(filePath)
  })
  return active.promise
}

async function performWriteTo(filePath: string, expectedMtimeMs: number | null): Promise<boolean> {
  const text = editorController.getText()
  const before = useDocumentStore.getState()
  const { lineEnding, savedText } = before
  try {
    const result = await api.fs.writeFile(filePath, text, {
      expectedMtimeMs,
      expectedText: expectedMtimeMs == null ? undefined : savedText,
      lineEnding,
    })
    if (!result.ok) {
      showConflictNotice(filePath)
      return false
    }
    // Watch first: for Save As this is what tells main which document the
    // window shows, and the editor builds image URLs the moment the store
    // publishes the new path. See adoptFile.
    await api.document.watch(filePath)
    const current = useDocumentStore.getState()
    if (current.filePath !== before.filePath || current.savedText !== before.savedText) return false
    current.markSaved({ filePath, text, mtimeMs: result.mtimeMs })
    current.setDirty(editorController.getText() !== text)
    await api.recents.add(filePath)
    useWorkspaceStore.getState().setNotice(null)
    return true
  } catch (error) {
    await api.dialog.showError({ title: 'Could not save file', message: unwrapIpcError(error) })
    return false
  }
}

function showConflictNotice(filePath: string): void {
  useWorkspaceStore.getState().setNotice({
    message: 'This file changed on disk since you loaded it.',
    actions: [
      {
        label: 'Overwrite',
        run: () => {
          void overwriteCurrentFile(filePath)
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

/** Writes after the user explicitly chooses to replace the disk version. */
export async function overwriteCurrentFile(filePath: string): Promise<void> {
  const before = useDocumentStore.getState()
  if (before.filePath !== filePath) return
  const text = editorController.getText()
  try {
    const result = await api.fs.writeFile(filePath, text, {
      force: true,
      lineEnding: before.lineEnding,
    })
    if (!result.ok) return
    const latest = useDocumentStore.getState()
    if (latest.filePath === filePath && latest.savedText === before.savedText) {
      latest.markSaved({ filePath, text, mtimeMs: result.mtimeMs })
      latest.setDirty(editorController.getText() !== text)
      useWorkspaceStore.getState().setNotice(null)
    }
  } catch (error) {
    await api.dialog.showError({ title: 'Could not save file', message: unwrapIpcError(error) })
  }
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
    const result = await api.fs.rename(filePath, name)
    const next = result.path
    if (wasOpen) {
      // Follow the file: the buffer is unchanged, only its identity moved.
      // Same ordering rule as adoptFile: main learns the new path first.
      await api.document.watch(next)
      const doc = useDocumentStore.getState()
      doc.load({ filePath: next, text: doc.savedText, mtimeMs: doc.mtimeMs, lineEnding: doc.lineEnding })
      doc.setDirty(editorController.getText() !== doc.savedText)
      await api.recents.add(next)
    }
    await refreshFolder()
    if (result.historyPath) {
      useWorkspaceStore.getState().setNotice({
        message: `Some version history could not be moved. Remaining history is associated with ${result.historyPath}.`,
        actions: [{ label: 'Dismiss', run: () => useWorkspaceStore.getState().setNotice(null) }],
      })
    }
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
