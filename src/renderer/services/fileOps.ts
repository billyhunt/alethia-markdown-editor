import { api, unwrapIpcError } from '../api.ts'
import { fileNameForDocument } from '../../shared/titles.ts'
import { editorController } from '../editor/editorController.ts'
import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import type { CreateFileResult, OpenPathEvent, RenameFileResult } from '../../shared/api.ts'

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
  // Main serves a document's images only while it has that document recorded
  // as open in this window, and `document.watch` is what records it. So it
  // goes before the editor learns the path: an image request that arrived
  // first would be refused as "not open", and the widget remembers a refusal
  // as a failed image.
  const documentId = await api.document.watch(filePath)
  // Re-reading the same file is a reload, not a different document, so it
  // keeps following its title. Opening a different one starts fresh.
  const previous = useDocumentStore.getState()
  const stillOurs = previous.filePath === filePath && previous.namedByTitle
  // Path next: the editor builds image URLs from it during setDocument, and
  // the store effect that would correct it runs a tick later. Without this,
  // opening B while A is open briefly requests B's images against A's folder.
  editorController.setFilePath(filePath)
  editorController.setDocument(content)
  useDocumentStore
    .getState()
    .load({ filePath, documentId, text: content, mtimeMs, lineEnding, namedByTitle: stillOurs })
  await api.recents.add(filePath)
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
  /**
   * A file chosen directly (Finder, Open...) shows its containing folder in the
   * sidebar, unless a workspace is already open: that one stays, because the
   * folder is the user's context and a document is not owned by it.
   */
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
  // ask about this window's document for nothing. When main finds no other
  // window it also claims the file for this one, so a second window asked at
  // the same moment is sent here instead of opening its own copy.
  let claimed = false
  if (!routed) {
    if (await api.window.revealDocument(filePath).catch(() => false)) return
    claimed = true
  }
  try {
    if (!(await ensureClosable())) return
    try {
      await adoptFile(filePath)
      if (preferDocument && !useWorkspaceStore.getState().folderRoot) {
        await adoptFolder(filePath.slice(0, filePath.lastIndexOf('/')) || '/')
      }
    } catch (error) {
      await api.dialog.showError({ title: 'Could not open file', message: unwrapIpcError(error) })
    }
  } finally {
    // Whether it opened, failed or was cancelled at the save prompt.
    if (claimed) await api.window.releaseDocument(filePath).catch(() => undefined)
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
    // Every folder opened becomes somewhere to switch back to.
    await api.recents.addFolder(root)
    await refreshRecentFolders()
  } catch (error) {
    await api.dialog.showError({ title: 'Could not open folder', message: unwrapIpcError(error) })
    // A folder that has gone away should stop being offered, rather than
    // failing the same way on every click for the rest of the session.
    await refreshRecentFolders()
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
  // An automatic rename moves the file out from under any save aimed at its
  // old name, so a save waits for one in flight and then reads the path.
  if (renaming) await renaming
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
  // A brand new path has nothing to conflict with. Naming it by hand also
  // ends the automatic naming: from here the file is the user's to call
  // whatever they like.
  return writeTo(chosen, null, true)
}

/**
 * Failures to file the current untitled buffer, counted per document so the
 * count of one buffer is never held against the next.
 */
let autoFileFailure: { revision: number; count: number } | null = null
/** Consecutive failed attempts, after which only a further edit tries again. */
const MAX_AUTO_FILE_ATTEMPTS = 3

/**
 * True while a failed attempt to file the open buffer is worth repeating
 * without waiting for another keystroke: the disk may only have been briefly
 * full or busy, and the user may be done typing.
 */
export function autoFileRetryable(): boolean {
  const { revision, filePath } = useDocumentStore.getState()
  return (
    filePath === null &&
    autoFileFailure !== null &&
    autoFileFailure.revision === revision &&
    autoFileFailure.count < MAX_AUTO_FILE_ATTEMPTS
  )
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
 * pause tries again, or when the file could not be created: the user is told
 * and autoFileRetryable says whether to try again by itself.
 */
export async function saveNewByTitle(): Promise<boolean> {
  const { filePath, autoNameable, lineEnding, revision } = useDocumentStore.getState()
  if (filePath || !autoNameable) return false
  const text = editorController.getText()
  const name = fileNameForDocument(text)
  if (!name) return false

  let created: CreateFileResult
  try {
    // The text goes in as the file is created, so a failure cannot leave an
    // empty file behind (main removes what a failed write started) and a
    // retry cannot leave a numbered trail of them.
    created = await api.fs.createFile({
      dir: useWorkspaceStore.getState().folderRoot,
      name,
      content: text,
      lineEnding,
    })
  } catch {
    // Saving on the user's behalf must never interrupt them with a dialog,
    // but it must not fail silently either: a folder that cannot be written
    // would otherwise leave someone typing into a document that is never
    // saved and never says so.
    const count = autoFileFailure?.revision === revision ? autoFileFailure.count + 1 : 1
    autoFileFailure = { revision, count }
    useWorkspaceStore.getState().setNotice({
      message: 'This document could not be saved automatically. Use Save As to choose a place.',
      actions: [
        { label: 'Save As', run: () => { void saveAs() } },
        { label: 'Dismiss', run: () => useWorkspaceStore.getState().setNotice(null) },
      ],
    })
    return false
  }
  autoFileFailure = null

  const claimable = (): boolean => {
    const doc = useDocumentStore.getState()
    return doc.revision === revision && doc.filePath === null
  }
  // Something else may take the editor while the file is being written. The
  // file holds the text it was created from, so nothing is lost -- but then
  // this buffer is no longer that document and must not claim its path.
  if (!claimable()) {
    await refreshFolder()
    return false
  }
  // Main learns which document the window shows before the editor learns the
  // path; see adoptFile. A failed watch must not strand a file that now
  // exists: with the path unpublished, the next pass would create another.
  const documentId = await api.document.watch(created.path).catch(() => null)
  if (!claimable()) {
    await refreshFolder()
    return false
  }
  const doc = useDocumentStore.getState()
  doc.markSaved({
    filePath: created.path,
    text,
    mtimeMs: created.mtimeMs,
    namedByTitle: true,
    // What the title asked for, which is not always what it got: a taken
    // name is numbered, and comparing against the numbered name later would
    // make the document try to rename itself forever.
    autoNameBase: name,
  })
  useDocumentStore.setState({ documentId })
  // Typing during the write leaves the buffer ahead of what was saved.
  doc.setDirty(editorController.getText() !== text)
  useWorkspaceStore.getState().setNotice(null)
  await api.recents.add(created.path)
  await refreshFolder()
  return true
}

/**
 * The name the title currently asks for, or null when the file already has it
 * (or has stopped following its title, or the title has gone away).
 *
 * Compared against the name the title last produced, not the name on disk:
 * a numbered file (Notes 2.md) would never match its own title and would
 * ask for the taken name on every save, then take it the moment it was
 * freed -- from the user's side, the file vanishing and reappearing under
 * a name they never chose.
 */
function wantedAutoName(): string | null {
  const { namedByTitle, filePath, autoNameBase } = useDocumentStore.getState()
  if (!namedByTitle || !filePath) return null
  const wanted = fileNameForDocument(editorController.getText())
  if (!wanted || wanted === autoNameBase || wanted === documentName(filePath)) return null
  return wanted
}

/**
 * Whether the title and the file name have drifted apart. Independent of the
 * dirty flag on purpose: a save can land while a rename is in flight and
 * clear it, and a title typed meanwhile still has to be followed.
 */
export const autoNamePending = (): boolean => wantedAutoName() !== null

/** The automatic rename in flight, if any. Never rejects. */
let renaming: Promise<void> | null = null

/**
 * Keeps an automatically named file's name in step with its title, so a
 * heading finished after the first save is not left behind on disk.
 *
 * Best effort by design: a name already taken, or any other failure, simply
 * leaves the current name in place.
 *
 * Renames are serialised, and a save waits for the one in flight (see save):
 * a save aimed at the name being renamed away would be refused as stale, or
 * worse, recreate it.
 */
export function syncAutoName(): Promise<void> {
  const turn = (renaming ?? Promise.resolve()).then(renameToTitle)
  renaming = turn
  void turn.then(() => {
    if (renaming === turn) renaming = null
  })
  return turn
}

async function renameToTitle(): Promise<void> {
  const start = useDocumentStore.getState()
  if (!start.namedByTitle || !start.filePath) return
  // A write in flight on this path goes first; so does the follow-up write it
  // may have coalesced, which would otherwise be aimed at the old name.
  await activeWrites.get(start.filePath)?.promise

  const { filePath, revision } = useDocumentStore.getState()
  const wanted = wantedAutoName()
  if (!wanted || !filePath) return

  let result: RenameFileResult
  try {
    result = await api.fs.rename(filePath, wanted)
  } catch {
    // The name is taken, or the move was refused. Record what the title
    // asked for anyway: retrying it every two seconds would achieve nothing
    // except to claim the name behind the user's back if it ever came free.
    const doc = useDocumentStore.getState()
    if (doc.revision === revision && doc.filePath === filePath) doc.setAutoNameBase(wanted)
    return
  }

  // Main learns the new path before the editor does; see adoptFile. If this
  // fails the file has moved all the same, so the path must still follow it.
  const documentId = await api.document.watch(result.path).catch(() => null)
  const doc = useDocumentStore.getState()
  // The document may have been closed or replaced while the rename was in
  // flight. The file on disk followed its title either way; the editor is
  // simply no longer showing it.
  if (doc.revision !== revision || doc.filePath !== filePath) {
    await refreshFolder()
    return
  }
  // Only the identity moved: the buffer, its dirty flag and its baseline
  // are unchanged, and the save that follows writes to the new path.
  doc.setPath(result.path, { namedByTitle: true, autoNameBase: wanted, documentId })
  await api.recents.add(result.path).catch(() => undefined)
  await refreshFolder()
  noticeIfHistoryStranded(result)
}

function noticeIfHistoryStranded(result: RenameFileResult): void {
  if (!result.historyPath) return
  useWorkspaceStore.getState().setNotice({
    message: `Some version history could not be moved. Remaining history is associated with ${result.historyPath}.`,
    actions: [{ label: 'Dismiss', run: () => useWorkspaceStore.getState().setNotice(null) }],
  })
}

interface ActiveWrite {
  queued: boolean
  /** Some request joined this write on behalf of a user-chosen name. */
  endsAutoNaming: boolean
  promise: Promise<boolean>
}

const activeWrites = new Map<string, ActiveWrite>()

function writeTo(
  filePath: string,
  expectedMtimeMs: number | null,
  endsAutoNaming = false,
): Promise<boolean> {
  const running = activeWrites.get(filePath)
  if (running) {
    running.queued = true
    running.endsAutoNaming ||= endsAutoNaming
    return running.promise
  }

  const active: ActiveWrite = { queued: false, endsAutoNaming, promise: Promise.resolve(false) }
  activeWrites.set(filePath, active)
  active.promise = (async () => {
    let result = false
    do {
      active.queued = false
      const attemptedText = editorController.getText()
      const current = useDocumentStore.getState()
      const expected = current.filePath === filePath ? current.mtimeMs : expectedMtimeMs
      result = await performWriteTo(filePath, expected, active.endsAutoNaming)
      if (!active.queued || editorController.getText() === attemptedText) return result
    } while (useDocumentStore.getState().filePath === filePath)
    return result
  })().finally(() => {
    if (activeWrites.get(filePath) === active) activeWrites.delete(filePath)
  })
  return active.promise
}

async function performWriteTo(
  filePath: string,
  expectedMtimeMs: number | null,
  endsAutoNaming: boolean,
): Promise<boolean> {
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
    const documentId = await api.document.watch(filePath)
    const current = useDocumentStore.getState()
    if (current.filePath !== before.filePath || current.savedText !== before.savedText) return false
    current.markSaved({
      filePath,
      text,
      mtimeMs: result.mtimeMs,
      // Left alone by a plain save, so it does not change who names the file.
      namedByTitle: endsAutoNaming ? false : undefined,
    })
    // markSaved dropped the id if the path changed (Save As); main has just
    // named the document at its new path, and relative links need that id.
    useDocumentStore.setState({ documentId })
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
  // These edits are never filed automatically: re-creating what was just sent
  // to the Trash, under nearly the same name, is the opposite of what was
  // asked for. An empty buffer left behind is just a new document, and
  // writing in it should file itself like any other.
  doc.load({
    filePath: null,
    text: '',
    mtimeMs: null,
    lineEnding: doc.lineEnding,
    autoNameable: !keepEdits,
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
  const startingDocument = useDocumentStore.getState()
  const wasOpen = startingDocument.filePath === filePath
  try {
    const result = await api.fs.rename(filePath, name)
    const next = result.path
    if (wasOpen) {
      // Follow the file: the buffer is unchanged, only its identity moved.
      // Same ordering rule as adoptFile: main learns the new path first.
      const documentId = await api.document.watch(next)
      const doc = useDocumentStore.getState()
      // Another document may have taken over the window while this ran.
      if (doc.revision === startingDocument.revision && doc.filePath === filePath) {
        doc.load({ filePath: next, documentId, text: doc.savedText, mtimeMs: doc.mtimeMs, lineEnding: doc.lineEnding })
        doc.setDirty(editorController.getText() !== doc.savedText)
      }
      await api.recents.add(next)
    }
    await refreshFolder()
    noticeIfHistoryStranded(result)
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
