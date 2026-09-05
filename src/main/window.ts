import path from 'node:path'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { IPC } from '../shared/ipc.ts'
import { hardenWebContents } from './security.ts'
import { getSettings, patchSettings } from './settings.ts'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const INDEX_HTML = path.join(import.meta.dirname, '../dist/index.html')

interface WindowState {
  /** Set once the renderer has confirmed it is safe to close. */
  forceClose: boolean
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
    state = { forceClose: false }
    states.set(win.id, state)
  }
  return state
}

export const markForceClose = (win: BrowserWindow): void => {
  stateFor(win).forceClose = true
}

/** Drops a saved position that would place the window off every display. */
function safeBounds(): Electron.Rectangle | { width: number; height: number } {
  const saved = getSettings().windowBounds
  if (saved.x == null || saved.y == null) {
    return { width: saved.width, height: saved.height }
  }
  const bounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const display = screen.getDisplayMatching(bounds)
  const wa = display.workArea
  const intersects =
    bounds.x < wa.x + wa.width &&
    bounds.x + bounds.width > wa.x &&
    bounds.y < wa.y + wa.height &&
    bounds.y + bounds.height > wa.y
  return intersects ? bounds : { width: saved.width, height: saved.height }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...safeBounds(),
    minWidth: 640,
    minHeight: 400,
    // Shown on ready-to-show so the user never sees a white flash.
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  })

  stateFor(win)
  win.once('ready-to-show', () => win.show())

  let boundsTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen()) {
        patchSettings({ windowBounds: win.getNormalBounds() })
      }
    }, 500)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)

  win.on('enter-full-screen', () => win.webContents.send(IPC.hostFullScreenChanged, true))
  win.on('leave-full-screen', () => win.webContents.send(IPC.hostFullScreenChanged, false))

  /**
   * Main never caches the dirty flag -- a keystroke immediately followed by
   * Cmd+W would race it. Every close is deferred to the renderer, which reads
   * its store synchronously and calls back.
   */
  win.on('close', (event) => {
    const state = stateFor(win)
    if (state.forceClose) return
    event.preventDefault()
    win.webContents.send(IPC.hostCloseRequested, { reason: isQuitting ? 'quit' : 'close' })
  })

  win.on('closed', () => {
    states.delete(win.id)
  })

  // A dead or wedged renderer must never trap the window open.
  win.webContents.on('render-process-gone', () => {
    stateFor(win).forceClose = true
  })
  win.webContents.on('unresponsive', () => {
    stateFor(win).forceClose = true
  })

  // In dev, surface renderer console output in the terminal running `npm run
  // dev`; without it the renderer's logs are only visible in DevTools.
  if (DEV_SERVER_URL) {
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${event.message}`)
    })
  }

  if (DEV_SERVER_URL) {
    hardenWebContents(win.webContents, DEV_SERVER_URL)
    void win.loadURL(DEV_SERVER_URL)
  } else {
    hardenWebContents(win.webContents, `file://${INDEX_HTML}`)
    void win.loadFile(INDEX_HTML)
  }

  return win
}
