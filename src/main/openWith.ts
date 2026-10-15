import fs from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { canonicalPath, grantFile, grantRoot, validatePath } from './paths.ts'
import {
  createWindow,
  deliver,
  hasShown,
  raise,
  restoreWindows,
  vacantWindow,
  windowShowing,
} from './windows.ts'
import { isReadablePath } from '../shared/markdown.ts'
import type { OpenPathEvent } from '../shared/api.ts'

/**
 * Finder fires `open-file` before `ready`, so opens are collected until the
 * app has started and can decide where each one belongs.
 */
const launched: OpenPathEvent[] = []
let started = false

/** True once startup has restored the session and routed launch files. */
export const hasStarted = (): boolean => started

async function classify(target: string): Promise<OpenPathEvent | null> {
  try {
    const stats = await fs.stat(target)
    if (stats.isDirectory()) return { path: grantRoot(target), kind: 'dir' }
    if (!isReadablePath(target)) return null

    // A direct file still grants its containing folder, but it does not open
    // that folder in the UI. The narrow root lets relative images resolve and
    // preserves the same capability boundary as an explicitly opened folder.
    grantRoot(path.dirname(target))
    grantFile(target)
    // Windows are matched on the real path, so a file reached through a
    // symlink or a /var alias of /private/var finds the window showing it.
    return { path: await canonicalPath(target), kind: 'file' }
  } catch {
    return null
  }
}

/** Resolves true when the path was accepted for opening. */
export async function enqueuePath(input: string): Promise<boolean> {
  let target: string
  try {
    target = validatePath(input)
  } catch {
    return false
  }
  const event = await classify(target)
  if (!event) return false

  if (!started) launched.push(event)
  else route(event)
  return true
}

/**
 * Sends a path to the right window.
 *
 * A file already open somewhere just brings that window forward -- opening a
 * second copy of one document would leave two editors autosaving over each
 * other. Otherwise an empty, untouched window takes it, and failing that a new
 * one is created, which is what makes several documents open side by side.
 */
export function route(event: OpenPathEvent): void {
  const existing = event.kind === 'file' ? windowShowing(event.path) : null
  if (existing) {
    raise(existing)
    return
  }

  const target = vacantWindow()
  if (target) {
    deliver(target, event)
    raise(target)
    return
  }

  // A new window shows itself, in front, once it has painted.
  deliver(createWindow(), event)
}

/**
 * Opens the previous session and whatever the app was launched with.
 *
 * Each launched file gets its own window rather than displacing a restored
 * document, and the file the user asked for ends up in front of the session
 * that came back around it.
 */
export function startUp(): void {
  started = true
  const opens = launched.splice(0)
  restoreWindows({ allowNone: opens.length > 0 })
  for (const event of opens) route(event)

  const last = opens.at(-1)
  const front = last && (last.kind === 'file' ? windowShowing(last.path) : null)
  if (front) raiseAfterEveryWindowShows(front)
}

/**
 * Restored windows show themselves as they finish painting, in whatever order
 * that happens, and each one shown lands on top. So the window that has to be
 * in front is raised once more after the last of them appears.
 */
function raiseAfterEveryWindowShows(front: BrowserWindow): void {
  const waiting = BrowserWindow.getAllWindows().filter((win) => !hasShown(win))
  let remaining = waiting.length
  const done = (): void => {
    remaining -= 1
    if (remaining === 0) raise(front)
  }
  if (remaining === 0) {
    raise(front)
    return
  }
  for (const win of waiting) {
    let counted = false
    // A window that never paints must not leave the front one buried.
    const fallback = setTimeout(() => {
      counted = true
      done()
    }, 5000)
    // Registered after createWindow's own handler, so this runs once the
    // window's show() has; setImmediate keeps it out of that call stack.
    win.once('ready-to-show', () => {
      clearTimeout(fallback)
      if (!counted) {
        counted = true
        setImmediate(done)
      } else if (remaining === 0) {
        // Painted after its fallback fired, so it just landed on top.
        setImmediate(() => raise(front))
      }
    })
  }
}

/**
 * Paths passed on the command line. In dev `electron .` occupies an extra
 * argv slot, so the offset differs from the packaged app. Resolves how many
 * were accepted.
 */
export async function enqueueArgv(argv: string[]): Promise<number> {
  let accepted = 0
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (arg.startsWith('-') || arg === '.') continue
    if (await enqueuePath(arg)) accepted += 1
  }
  return accepted
}
