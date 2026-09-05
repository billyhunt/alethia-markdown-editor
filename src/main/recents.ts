import { app } from 'electron'
import { getSettings, patchSettings } from './settings.ts'
import { grantFile, validatePath } from './paths.ts'

const MAX_RECENTS = 20

export function listRecents(): string[] {
  return getSettings().recentFiles
}

/**
 * Kept in two places: the native File > Open Recent / Dock menu, and our own
 * settings for the welcome screen.
 */
export function addRecent(input: unknown): void {
  const filePath = validatePath(input)
  const next = [filePath, ...getSettings().recentFiles.filter((p) => p !== filePath)].slice(
    0,
    MAX_RECENTS,
  )
  patchSettings({ recentFiles: next })
  app.addRecentDocument(filePath)
  // A file we previously opened stays openable across launches.
  grantFile(filePath)
}

export function clearRecents(): void {
  patchSettings({ recentFiles: [] })
  app.clearRecentDocuments()
}

/** Re-grants persisted recents at startup so they can be reopened. */
export function grantPersistedRecents(): void {
  for (const filePath of getSettings().recentFiles) {
    try {
      grantFile(filePath)
    } catch {
      /* skip malformed entries */
    }
  }
}
