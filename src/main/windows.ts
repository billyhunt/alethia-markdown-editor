import path from 'node:path'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { IPC } from '../shared/ipc.ts'
import { EMPTY_SESSION, type WindowSession } from '../shared/settings.ts'
import type { OpenPathEvent } from '../shared/api.ts'
import { hardenWebContents } from './security.ts'
import { getSettings, patchSettings } from './settings.ts'
import { closeWatchersFor } from './watcher.ts'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const INDEX_HTML = path.join(import.meta.dirname, '../dist/index.html')

interface WindowState {
  /** Set once the renderer has confirmed it is safe to close. */
  forceClose: boolean
  /** What this window should restore, handed over when its renderer starts. */
  session: WindowSession
  /** The document currently open (its real path), so a file can be routed to it. */
  filePath: string | null
  /**
   * A file routed here that the renderer has not finished opening. Between
   * the routing decision and the renderer reporting its document, the window
   * is spoken for: a second file must not be routed into it as well.
   */
  incoming: string | null
  /** Opens waiting for this window's renderer to start listening. */
  pending: OpenPathEvent[]
  /** Unsaved changes, as last reported by the renderer for the title bar. */
  edited: boolean
  /** The workspace folder, kept for session persistence. */
  folder: string | null
  /** True once its renderer has registered its listeners. */
  ready: boolean
  /** True once it has painted and been shown for the first time. */
  shown: boolean
}

const states = new Map<number, WindowState>()
let isQuitting = false

export const setQuitting = (value: boolean): void => {
  isQuitting = value
}
export const getQuitting = (): boolean => isQuitting

const stateFor = (win: BrowserWindow): WindowState => {
  let state = states.get(win.id)
  if (!state) {
    state = {
      forceClose: false,
      session: { ...EMPTY_SESSION },
      filePath: null,
      incoming: null,
      pending: [],
      edited: false,
      folder: null,
      ready: false,
      shown: false,
    }
    states.set(win.id, state)
  }
  return state
}

export const markForceClose = (win: BrowserWindow): void => {
  stateFor(win).forceClose = true
}

/**
 * Claims this window's session and the opens queued for it, and marks it
 * ready to receive events. Each window drains only its own queue, so a file
 * can never be picked up by whichever window happened to start first.
 */
export function takeSession(win: BrowserWindow): { session: WindowSession; pending: OpenPathEvent[] } {
  const state = stateFor(win)
  state.ready = true
  return { session: state.session, pending: state.pending.splice(0) }
}

/** Records what a window is showing, so files can be routed to it. */
export function noteDocument(win: BrowserWindow, filePath: string | null): void {
  const state = stateFor(win)
  state.filePath = filePath
  state.incoming = null
  persistSessions()
}

export function noteEdited(win: BrowserWindow, edited: boolean): void {
  stateFor(win).edited = edited
}

/**
 * The renderer finished handling a routed open, whether or not it succeeded.
 * Returns the file that had been routed here, if any.
 */
export function settleIncoming(win: BrowserWindow): string | null {
  const state = stateFor(win)
  const incoming = state.incoming
  state.incoming = null
  return incoming
}

export function noteFolder(win: BrowserWindow, folder: string | null): void {
  stateFor(win).folder = folder
  persistSessions()
}

/** The window showing, or about to show, this file (by real path), if any. */
export function windowShowing(realPath: string, except?: BrowserWindow): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === except || win.isDestroyed()) continue
    const state = states.get(win.id)
    if (state && (state.filePath === realPath || state.incoming === realPath)) return win
  }
  return null
}

/**
 * A window that can take a file without displacing anything: no document,
 * none on its way, no workspace, and nothing typed into it. Avoids spawning a
 * second window when the first is still the empty one from launch, without
 * ever putting a save prompt between the user and the file they asked for, or
 * hiding a folder the user left open.
 */
export function vacantWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  const candidates = focused ? [focused, ...BrowserWindow.getAllWindows()] : BrowserWindow.getAllWindows()
  for (const win of candidates) {
    const state = states.get(win.id)
    // A window still loading qualifies too: deliver() queues the file for it.
    if (
      state &&
      state.filePath === null &&
      state.folder === null &&
      state.incoming === null &&
      state.pending.length === 0 &&
      !state.edited
    ) {
      return win
    }
  }
  return null
}

/**
 * Hands an open to one window: straight to its renderer when it is listening,
 * otherwise into that window's own queue. Either way the window is reserved
 * at once -- for a folder as much as a file -- so the next routing decision
 * sees it as taken.
 */
export function deliver(win: BrowserWindow, event: OpenPathEvent): void {
  const state = stateFor(win)
  state.incoming = event.path
  if (state.ready) win.webContents.send(IPC.hostOpenPath, event)
  else state.pending.push(event)
}

/**
 * Brings a window to the front, restoring it from the Dock if needed. A window
 * that has not painted yet is left alone: it shows itself, in front, when it
 * is ready, and focusing it early would show it blank.
 */
export function raise(win: BrowserWindow): void {
  // Not isVisible(): a minimized window reports false, and must come back.
  if (win.isDestroyed() || !hasShown(win)) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

/** False until a window has painted and shown itself for the first time. */
export const hasShown = (win: BrowserWindow): boolean => states.get(win.id)?.shown ?? false

/** Writes the current window layout so the next launch can restore it. */
export function persistSessions(): void {
  const windows = BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map((win) => {
      const state = states.get(win.id)
      return {
        bounds: win.isFullScreen() ? (state?.session.bounds ?? getSettings().windowBounds) : win.getNormalBounds(),
        folder: state?.folder ?? null,
        file: state?.filePath ?? null,
      }
    })
  if (windows.length > 0) patchSettings({ windows })
}

/** Drops a saved position that would place the window off every display. */
function safeBounds(session: WindowSession): Electron.Rectangle | { width: number; height: number } {
  const saved = session.bounds
  if (saved.x == null || saved.y == null) return { width: saved.width, height: saved.height }

  const bounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const wa = screen.getDisplayMatching(bounds).workArea
  const intersects =
    bounds.x < wa.x + wa.width &&
    bounds.x + bounds.width > wa.x &&
    bounds.y < wa.y + wa.height &&
    bounds.y + bounds.height > wa.y
  return intersects ? bounds : { width: saved.width, height: saved.height }
}

/**
 * Offsets a new window so it does not land exactly on top of an existing one.
 *
 * A session with its own remembered position is left alone -- that placement
 * was the user's. Only windows without one are stepped down from the most
 * recently opened, which is what stops two new windows sitting in the same
 * spot and looking like a single window that failed to open.
 */
function cascade(
  bounds: Electron.Rectangle | { width: number; height: number },
  hasSavedPosition: boolean,
) {
  if (hasSavedPosition) return bounds
  const open = BrowserWindow.getAllWindows()
  if (open.length === 0) return bounds
  const last = open[open.length - 1].getNormalBounds()
  return { ...bounds, x: last.x + 26, y: last.y + 26 }
}

export function createWindow(session: WindowSession = { ...EMPTY_SESSION }): BrowserWindow {
  const hasSavedPosition = session.bounds.x != null && session.bounds.y != null
  const win = new BrowserWindow({
    ...cascade(safeBounds(session), hasSavedPosition),
    minWidth: 640,
    minHeight: 400,
    // Shown on ready-to-show so the user never sees a white flash.
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#f2f0eb',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  })

  const state = stateFor(win)
  state.session = session
  state.folder = session.folder
  state.filePath = session.file

  // Marked here rather than on 'show', which macOS does not always emit for
  // a window shown while the app is in the background.
  win.once('ready-to-show', () => {
    stateFor(win).shown = true
    win.show()
  })

  let boundsTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen()) persistSessions()
    }, 500)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)

  win.on('enter-full-screen', () => win.webContents.send(IPC.hostFullScreenChanged, true))
  win.on('leave-full-screen', () => win.webContents.send(IPC.hostFullScreenChanged, false))

  /**
   * Main never caches the dirty flag -- a keystroke immediately followed by
   * Cmd+W would race it. Every close is deferred to that window's renderer,
   * which reads its own store synchronously and calls back. With several
   * windows open, each is asked in turn.
   */
  win.on('close', (event) => {
    const state = stateFor(win)
    // A renderer that has not started listening holds no edits, and would
    // never answer the question, so the window would refuse to close.
    if (state.forceClose || !state.ready) return
    event.preventDefault()
    win.webContents.send(IPC.hostCloseRequested, { reason: isQuitting ? 'quit' : 'close' })
  })

  win.on('closed', () => {
    // Its watchers belong to it and must not outlive it.
    void closeWatchersFor(win.id)
    states.delete(win.id)
  })

  // A dead or wedged renderer must never trap the window open.
  win.webContents.on('render-process-gone', () => {
    stateFor(win).forceClose = true
  })
  win.webContents.on('unresponsive', () => {
    stateFor(win).forceClose = true
  })

  if (DEV_SERVER_URL) {
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${event.message}`)
    })
    hardenWebContents(win.webContents, DEV_SERVER_URL)
    void win.loadURL(DEV_SERVER_URL)
  } else {
    hardenWebContents(win.webContents, `file://${INDEX_HTML}`)
    void win.loadFile(INDEX_HTML)
  }

  return win
}

/**
 * Reopens the windows from the previous session, or one empty window. With
 * `allowNone`, an empty session opens nothing, because the files the app was
 * launched with will bring windows of their own.
 */
export function restoreWindows({ allowNone = false } = {}): BrowserWindow[] {
  const sessions = getSettings().windows
  if (sessions.length === 0) return allowNone ? [] : [createWindow()]
  // One document, one window, even if a session was saved with a file in two.
  const claimed = new Set<string>()
  return sessions.map((session) => {
    if (!session.file) return createWindow(session)
    if (claimed.has(session.file)) return createWindow({ ...session, file: null })
    claimed.add(session.file)
    return createWindow(session)
  })
}
