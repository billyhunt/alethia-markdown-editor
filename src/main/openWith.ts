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
 * Sends a path to the right window, which is returned. That window ends up in
 * front, behind none of the windows still on their way up.
 *
 * A file already open somewhere just brings that window forward -- opening a
 * second copy of one document would leave two editors autosaving over each
 * other. Otherwise an empty, untouched window takes it, and failing that a new
 * one is created, which is what makes several documents open side by side.
 */
export function route(event: OpenPathEvent): BrowserWindow {
  const target = chooseWindow(event)
  bringToFront(target)
  return target
}

function chooseWindow(event: OpenPathEvent): BrowserWindow {
  const existing = event.kind === 'file' ? windowShowing(event.path) : null
  if (existing) return existing

  const vacant = vacantWindow()
  if (vacant) {
    deliver(vacant, event)
    return vacant
  }

  // A new window shows itself, in front, once it has painted.
  const created = createWindow()
  deliver(created, event)
  return created
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
}

/**
 * Windows show themselves as they finish painting, in whatever order that
 * happens, and each one shown lands on top -- restored sessions and rapid
 * opens alike. So the newest request is raised again once the windows ahead
 * of it have all shown, rather than whichever happened to paint last winning.
 */
const PAINT_GRACE_MS = 5000
let newest: BrowserWindow | null = null
const awaitingPaint = new Map<BrowserWindow, NodeJS.Timeout>()
const listening = new WeakSet<BrowserWindow>()

function bringToFront(win: BrowserWindow): void {
  newest = win
  // A no-op until it has painted, which is what the wait below is for.
  raise(win)
  for (const other of BrowserWindow.getAllWindows()) {
    if (!hasShown(other)) awaitPaint(other)
  }
}

function paintSettled(win: BrowserWindow): void {
  clearTimeout(awaitingPaint.get(win))
  awaitingPaint.delete(win)
  if (awaitingPaint.size === 0 && newest) raise(newest)
}

function awaitPaint(win: BrowserWindow): void {
  if (awaitingPaint.has(win)) return
  // A window that never paints must not leave the front one buried.
  awaitingPaint.set(win, setTimeout(() => paintSettled(win), PAINT_GRACE_MS))
  if (listening.has(win)) return
  listening.add(win)
  // Registered after createWindow's own handler, so this runs once the
  // window's show() has; setImmediate keeps it out of that call stack. A
  // window painting after its grace ran out settles again and so lands
  // underneath the newest request, not on top of it.
  win.once('ready-to-show', () => setImmediate(() => paintSettled(win)))
  win.once('closed', () => paintSettled(win))
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
