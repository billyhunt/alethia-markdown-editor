import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { grantFile, grantRoot, validatePath } from './paths.ts'
import { createWindow, isReady, noteDocument, noteFolder, vacantWindow, windowShowing } from './windows.ts'
import { IPC } from '../shared/ipc.ts'
import { isReadablePath } from '../shared/markdown.ts'
import type { OpenPathEvent } from '../shared/api.ts'

/**
 * Finder fires `open-file` before `ready` and long before any renderer has
 * mounted, so paths are buffered until a window is listening.
 */
const pending: OpenPathEvent[] = []
let anyWindowReady = false

async function classify(target: string): Promise<OpenPathEvent | null> {
  try {
    const realTarget = await fs.realpath(target)
    const stats = await fs.stat(realTarget)
    if (stats.isDirectory()) return { path: grantRoot(realTarget), kind: 'dir' }
    if (!isReadablePath(realTarget)) return null

    // Opening a file from Finder also grants its containing folder, so the
    // sidebar can list its siblings. Double-clicking a note and being told to
    // go and open a folder is not a useful place to land. The user picked
    // this file, so its own directory is the narrowest workspace that makes
    // the window usable.
    grantRoot(path.dirname(realTarget))
    return { path: grantFile(realTarget), kind: 'file' }
  } catch {
    return null
  }
}

export async function enqueuePath(input: string): Promise<void> {
  let target: string
  try {
    target = validatePath(input)
  } catch {
    return
  }
  const event = await classify(target)
  if (!event) return

  if (!anyWindowReady) {
    if (event.kind === 'file' && pending.some((entry) => entry.kind === 'file' && entry.path === event.path)) return
    pending.push(event)
    return
  }
  route(event)
}

/**
 * Sends a path to the right window.
 *
 * A file already open somewhere just brings that window forward -- opening a
 * second copy of one document would leave two editors autosaving over each
 * other. Otherwise an empty window takes it, and failing that a new one is
 * created, which is what makes several documents open side by side.
 */
export function route(event: OpenPathEvent, allowVacant = true): void {
  const existing = event.kind === 'file' ? windowShowing(event.path) : null
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }

  const vacant = allowVacant ? vacantWindow() : null
  if (vacant && isReady(vacant)) {
    vacant.webContents.send(IPC.hostOpenPath, event)
    vacant.focus()
    return
  }
  createWindow({ bounds: { width: 1100, height: 760 }, folder: event.kind === 'dir' ? event.path : path.dirname(event.path), file: event.kind === 'file' ? event.path : null })
}

/** Called by the app:rendererReady handler; drains and clears the queue. */
export function takePendingPaths(canUseThisWindow = true, readyWindow?: Electron.BrowserWindow | null): OpenPathEvent[] {
  anyWindowReady = true
  const entries = pending.splice(0, pending.length)
  const [first, ...rest] = entries
  for (const entry of rest) route(entry, false)
  if (first && canUseThisWindow) {
    if (readyWindow) {
      if (first.kind === 'file') noteDocument(readyWindow, first.path)
      noteFolder(readyWindow, first.kind === 'dir' ? first.path : path.dirname(first.path))
    }
    return [first]
  }
  if (first) route(first, false)
  return []
}

/**
 * Paths passed on the command line. In dev `electron .` occupies an extra
 * argv slot, so the offset differs from the packaged app.
 */
export async function enqueueArgv(argv: string[]): Promise<void> {
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (arg.startsWith('-') || arg === '.') continue
    await enqueuePath(arg)
  }
}
