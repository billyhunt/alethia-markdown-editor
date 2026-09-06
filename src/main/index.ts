import path from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { createMainWindow, getQuitting, setQuitting } from './window.ts'
import { registerIpcHandlers } from './ipc.ts'
import { hardenSession } from './security.ts'
import { buildApplicationMenu } from './menu.ts'
import { flushSettings, getSettings, loadSettings } from './settings.ts'
import { grantPersistedRecents } from './recents.ts'
import { applyTheme } from './theme.ts'
import { enqueueArgv, enqueuePath } from './openWith.ts'
import { closeAllWatchers } from './watcher.ts'

// Registered at module top level: Finder fires open-file before 'ready', and
// a listener attached later would miss it entirely.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  void enqueuePath(filePath)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    void enqueueArgv(argv)
  })

  app.whenReady().then(async () => {
    // In development the Dock shows the Electron bundle's icon, because that
    // is the app macOS actually launched. This is the one piece of its
    // identity that can still be replaced once we are running.
    if (!app.isPackaged) {
      const icon = nativeImage.createFromPath(
        path.join(import.meta.dirname, '..', 'build', 'icon.png'),
      )
      if (!icon.isEmpty()) app.dock?.setIcon(icon)
    }

    loadSettings()
    grantPersistedRecents()
    applyTheme(getSettings().theme)
    hardenSession()
    registerIpcHandlers()
    buildApplicationMenu()
    await enqueueArgv(process.argv)
    createMainWindow()

    // macOS: clicking the dock icon with no windows open reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    setQuitting(true)
  })

  app.on('will-quit', () => {
    flushSettings()
    void closeAllWatchers()
  })

  app.on('window-all-closed', () => {
    // On macOS the app stays alive with no windows unless the user quits --
    // but if a quit was already in flight, honour it.
    if (process.platform !== 'darwin' || getQuitting()) app.quit()
  })
}
