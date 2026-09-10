import fs from 'node:fs/promises'
import { app } from 'electron'
import { getSettings, patchSettings } from './settings.ts'
import { grantFile, grantRoot, validatePath } from './paths.ts'
import { buildApplicationMenu } from './menu.ts'

const MAX_RECENTS = 20

/** Short enough to stay a switcher rather than a history. */
const MAX_RECENT_FOLDERS = 10

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
 * Workspace folders behave like Obsidian's vaults: the last several are kept
 * so switching between them takes a click rather than a directory dialog.
 *
 * Folders that have since been moved or deleted are dropped when the list is
 * read, so the switcher never offers something that cannot be opened.
 */
export async function listRecentFolders(): Promise<string[]> {
  const stored = getSettings().recentFolders
  const alive: string[] = []
  for (const dir of stored) {
    const stats = await fs.stat(dir).catch(() => null)
    if (stats?.isDirectory()) alive.push(dir)
  }
  if (alive.length !== stored.length) {
    patchSettings({ recentFolders: alive })
    buildApplicationMenu()
  }
  return alive
}

export function addRecentFolder(input: unknown): void {
  const dirPath = validatePath(input)
  const next = [dirPath, ...getSettings().recentFolders.filter((p) => p !== dirPath)].slice(
    0,
    MAX_RECENT_FOLDERS,
  )
  patchSettings({ recentFolders: next })
  // A folder we previously opened stays openable across launches.
  grantRoot(dirPath)
  // The File menu carries the same list, so it has to follow.
  buildApplicationMenu()
}

export function clearRecentFolders(): void {
  patchSettings({ recentFolders: [] })
  buildApplicationMenu()
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
  // Recent workspace folders, so the switcher can open one without sending
  // the user back through a directory dialog.
  for (const dirPath of settings.recentFolders) {
    try {
      grantRoot(dirPath)
    } catch {
      /* skip malformed entries */
    }
  }
  // Every window's saved folder and file, so each can restore itself.
  for (const session of settings.windows) {
    if (session.folder) {
      try {
        grantRoot(session.folder)
      } catch {
        /* ignore */
      }
    }
    if (session.file) {
      try {
        grantFile(session.file)
      } catch {
        /* ignore */
      }
    }
  }
}
