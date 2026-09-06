import { useCallback, useEffect, useState } from 'react'
import { api, unwrapIpcError } from '../api.ts'
import { editorController } from '../editor/editorController.ts'
import { openPath } from '../services/fileOps.ts'
import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import type { DocumentVersion } from '../../shared/api'

function relativeTime(epochMs: number): string {
  const seconds = Math.round((Date.now() - epochMs) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Notes are usually small, so kilobytes alone would read "0.0k" for most. */
const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}k`

const exactTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function History() {
  const openFile = useDocumentStore((state) => state.filePath)
  const savedText = useDocumentStore((state) => state.savedText)
  const historyTarget = useWorkspaceStore((state) => state.historyTarget)
  const showHistoryFor = useWorkspaceStore((state) => state.showHistoryFor)
  const [versions, setVersions] = useState<DocumentVersion[]>([])

  // Right-clicking a file in the tree pins the panel to that file; otherwise
  // it follows whatever is open.
  const target = historyTarget ?? openFile
  const isPinned = historyTarget !== null && historyTarget !== openFile

  const refresh = useCallback(() => {
    // No synchronous setState here: the empty case is handled during render.
    if (!target) return
    void api.versions
      .list(target)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [target])

  // savedText changes on every write, which is exactly when a new snapshot
  // may have appeared.
  useEffect(refresh, [refresh, savedText])

  const restore = (version: DocumentVersion) => {
    if (!target) return
    void api.versions
      .read(target, version.id)
      .then(async (content) => {
        // Restoring a file that is not open would drop its content into the
        // wrong document, so open it first and bail if that was declined.
        if (target !== openFile) {
          await openPath(target)
          if (useDocumentStore.getState().filePath !== target) return
        }
        // An ordinary edit rather than a write: it joins the undo history and
        // nothing reaches disk until saved.
        editorController.replaceAll(content)
        useWorkspaceStore.getState().setNotice({
          message: `Restored the version from ${exactTime(version.savedAt)}. Not saved yet.`,
          actions: [
            { label: 'Undo', run: () => editorController.exec('undo') },
            { label: 'Dismiss', run: () => useWorkspaceStore.getState().setNotice(null) },
          ],
        })
      })
      .catch((error: unknown) =>
        api.dialog.showError({
          title: 'Could not read that version',
          message: unwrapIpcError(error),
        }),
      )
  }

  if (!target) {
    return <p className="sidebar-empty">No file open. Right-click a file to see its history.</p>
  }

  return (
    <>
      {isPinned && (
        <div className="history-pin">
          <span className="tree-label">{documentName(target)}</span>
          <button type="button" className="history-unpin" onClick={() => showHistoryFor(null)}>
            Clear
          </button>
        </div>
      )}
      {versions.length === 0 ? (
        <p className="sidebar-empty">
          No earlier versions yet. One is kept each time a save replaces this file.
        </p>
      ) : (
        versions.map((version) => (
          <button
            key={version.id}
            type="button"
            className="tree-row history-row"
            onClick={() => restore(version)}
            title={`${exactTime(version.savedAt)} — click to restore into the editor`}
          >
            <span className="tree-label">{relativeTime(version.savedAt)}</span>
            <span className="history-size">{formatBytes(version.bytes)}</span>
          </button>
        ))
      )}
    </>
  )
}
