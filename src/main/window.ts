import path from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { hardenWebContents } from './security.ts'

/**
 * In dev, vite-plugin-electron sets VITE_DEV_SERVER_URL and the renderer is
 * served over http with HMR. In the packaged app it is absent and we load the
 * built HTML from disk. `import.meta.dirname` resolves correctly in both
 * cases, including from inside app.asar.
 */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const INDEX_HTML = path.join(import.meta.dirname, '../dist/index.html')

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    // Shown on 'ready-to-show' so the user never sees a white flash.
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload needs only contextBridge/ipcRenderer, both available in a
      // sandboxed preload, so there is no reason to weaken this.
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !process.env.NODE_ENV?.startsWith('prod'),
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  if (DEV_SERVER_URL) {
    hardenWebContents(win.webContents, DEV_SERVER_URL)
    void win.loadURL(DEV_SERVER_URL)
  } else {
    hardenWebContents(win.webContents, `file://${INDEX_HTML}`)
    void win.loadFile(INDEX_HTML)
  }

  return win
}
