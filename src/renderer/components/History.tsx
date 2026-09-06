import { useCallback, useEffect, useState } from 'react'
import { api, unwrapIpcError } from '../api.ts'
import { editorController } from '../editor/editorController.ts'
import { useDocumentStore } from '../state/documentStore.ts'
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
  const filePath = useDocumentStore((state) => state.filePath)
  const savedText = useDocumentStore((state) => state.savedText)
  const [versions, setVersions] = useState<DocumentVersion[]>([])

  const refresh = useCallback(() => {
    // No synchronous setState here: the empty case is handled during render,
    // and clearing it eagerly would only cause an extra pass.
    if (!filePath) return
    void api.versions
      .list(filePath)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [filePath])

  // savedText changes on every write, which is exactly when a new snapshot
  // may have appeared.
  useEffect(refresh, [refresh, savedText])

  if (!filePath) {
    return <p className="sidebar-empty">No file open.</p>
  }

  // Versions belong to whichever file was fetched last; while a new fetch is
  // in flight the list is simply empty rather than another file's history.
  if (versions.length === 0) {
    return (
      <p className="sidebar-empty">
        No earlier versions yet. One is kept each time a save replaces the file.
      </p>
    )
  }

  const restore = (version: DocumentVersion) => {
    void api.versions
      .read(filePath, version.id)
      .then((content) => {
        // Applied as an ordinary edit rather than written to disk, so it
        // lands in the undo history and nothing is committed until saved.
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

  return (
    <>
      {versions.map((version) => (
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
      ))}
    </>
  )
}
