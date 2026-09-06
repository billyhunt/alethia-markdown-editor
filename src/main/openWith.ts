import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { IPC } from '../shared/ipc.ts'
import { grantFile, grantRoot, validatePath } from './paths.ts'
import { sendToRenderer, focusedWindow } from './commands.ts'
import { isReadablePath } from '../shared/markdown.ts'
import type { OpenPathEvent } from '../shared/api.ts'

/**
 * Finder fires `open-file` before `ready` and long before React has mounted,
 * so paths must be buffered until the renderer says it is listening.
 */
const pending: OpenPathEvent[] = []
let rendererReady = false

async function classify(target: string): Promise<OpenPathEvent | null> {
  try {
    const stats = await fs.stat(target)
    if (stats.isDirectory()) return { path: grantRoot(target), kind: 'dir' }
    if (!isReadablePath(target)) return null

    // Opening a file from Finder also grants its containing folder, so the
    // sidebar can list its siblings. Double-clicking a note and being told to
    // go and open a folder is not a useful place to land. The user picked
    // this file, so its own directory is the narrowest workspace that makes
    // the window usable.
    grantRoot(path.dirname(target))
    return { path: grantFile(target), kind: 'file' }
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

  if (rendererReady) {
    sendToRenderer(focusedWindow(), IPC.hostOpenPath, event)
  } else {
    pending.push(event)
  }
}

/** Called by the app:rendererReady handler; drains and clears the queue. */
export function takePendingPaths(): OpenPathEvent[] {
  rendererReady = true
  return pending.splice(0, pending.length)
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
