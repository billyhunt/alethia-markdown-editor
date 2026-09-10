import fs from 'node:fs/promises'
import { app, BrowserWindow } from 'electron'
import { getSettings, patchSettings } from './settings.ts'
import { assertReadable, assertReadableDir, grantFile, grantRoot } from './paths.ts'
import { buildApplicationMenu } from './menu.ts'
import { IPC } from '../shared/ipc.ts'
import { MAX_RECENTS, MAX_RECENT_FOLDERS } from '../shared/settings.ts'

export function listRecents(): string[] {
  return getSettings().recentFiles
}

/**
 * Kept in two places: the native File > Open Recent / Dock menu, and our own
 * settings for the welcome screen.
 *
 * Recording a path must never be a way to acquire access to it. The path has
 * to be granted already -- by a dialog, an open-file event, argv, a
 * validated drop, or a file this app created -- so a compromised renderer
 * cannot nominate an arbitrary file and have it become readable.
 */
export async function addRecent(input: unknown): Promise<void> {
  const filePath = await assertReadable(input)
  const next = [filePath, ...getSettings().recentFiles.filter((p) => p !== filePath)].slice(
    0,
    MAX_RECENTS,
  )
  patchSettings({ recentFiles: next })
  app.addRecentDocument(filePath)
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
  // Checked in parallel: one entry on a sleeping network share should not
  // hold up the switcher, or window restore, for everything behind it.
  const alive = (
    await Promise.all(
      stored.map(async (dir) => {
        try {
          return (await fs.stat(dir)).isDirectory() ? dir : null
        } catch (error) {
          // Only definite absence drops a folder. An unplugged drive, a
          // sleeping share or a permission prompt that was declined is a
          // temporary condition, and forgetting the user's vault over one
          // would be unrecoverable from here.
          const code = (error as NodeJS.ErrnoException).code
          return code === 'ENOENT' || code === 'ENOTDIR' ? null : dir
        }
      }),
    )
  ).filter((dir): dir is string => dir !== null)

  if (alive.length !== stored.length) {
    patchSettings({ recentFolders: alive })
    announceRecentFolders(alive)
  }
  return alive
}

/**
 * Recents are application-wide, so every window has to hear about a change.
 * Without this a second window keeps showing the list it read at startup
 * while the native switcher, built in main, shows the truth.
 */
function announceRecentFolders(folders: string[]): void {
  buildApplicationMenu()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.hostRecentFoldersChanged, folders)
  }
}

/**
 * As with files, recording a folder grants nothing. Only a folder already
 * granted -- opened through the directory dialog, or dropped and validated --
 * can be remembered, so this endpoint cannot be used to hand the renderer a
 * whole subtree it was never given.
 */
export async function addRecentFolder(input: unknown): Promise<void> {
  const dirPath = await assertReadableDir(input)
  const next = [dirPath, ...getSettings().recentFolders.filter((p) => p !== dirPath)].slice(
    0,
    MAX_RECENT_FOLDERS,
  )
  patchSettings({ recentFolders: next })
  // The File menu and every other window carry the same list.
  announceRecentFolders(next)
}

export function clearRecentFolders(): void {
  patchSettings({ recentFolders: [] })
  announceRecentFolders([])
}

/**
 * A renamed file is not a second recent document.
 *
 * Automatic naming renames as a title grows, so without this every
 * intermediate name ("No.md" on the way to "Notes.md") would be left in File
 * > Open Recent and in the Dock menu, pointing at nothing.
 */
export function renameRecent(from: string, to: string): void {
  const current = getSettings().recentFiles
  const next = [to, ...current.filter((p) => p !== from && p !== to)].slice(0, MAX_RECENTS)
  if (next.length === current.length && next.every((p, i) => p === current[i])) return
  patchSettings({ recentFiles: next })
  // The native list has no per-item removal, so it is rebuilt newest-last.
  app.clearRecentDocuments()
  for (const filePath of [...next].reverse()) app.addRecentDocument(filePath)
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
