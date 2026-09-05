import { app } from 'electron'
import { getSettings, patchSettings } from './settings.ts'
import { grantFile, grantRoot, validatePath } from './paths.ts'

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

/**
 * Re-grants everything the previous session had open, so session restore can
 * read it back without prompting the user for a dialog again.
 */
export function grantPersistedRecents(): void {
  const settings = getSettings()
  for (const filePath of settings.recentFiles) {
    try {
      grantFile(filePath)
    } catch {
      /* skip malformed entries */
    }
  }
  if (settings.lastFolder) {
    try {
      grantRoot(settings.lastFolder)
    } catch {
      /* ignore */
    }
  }
  if (settings.lastFile) {
    try {
      grantFile(settings.lastFile)
    } catch {
      /* ignore */
    }
  }
}
