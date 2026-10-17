import path from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { documentShownBy, getQuitting, persistSessions, raise, restoreWindows, setQuitting } from './windows.ts'
import { registerIpcHandlers } from './ipc.ts'
import { hardenSession } from './security.ts'
import { buildApplicationMenu } from './menu.ts'
import { flushSettings, getSettings, loadSettings } from './settings.ts'
import { grantPersistedRecents } from './recents.ts'
import { applyTheme } from './theme.ts'
import { enqueueArgv, enqueuePath, hasStarted, startUp } from './openWith.ts'
import { closeAllWatchers } from './watcher.ts'
import { installImageProtocol, registerImageScheme, setOpenDocumentLookup } from './images.ts'

// Finder delivers file opens before `ready`, while resolving each path is
// asynchronous. Drain this serial queue before restoring any previous session
// so the file the user clicked cannot lose a startup race to a blank window.
let finderOpenQueue = Promise.resolve()

// End-to-end tests launch against a throwaway profile, so a run never reads or
// overwrites a real session. The single-instance lock lives in userData too,
// which keeps a test launch from handing its files to an installed copy.
// Unpackaged builds only: in the shipped app the environment must not move
// the profile, or the guard that keeps renderer writes out of it.
const profileOverride = app.isPackaged ? undefined : process.env.ALETHIA_USER_DATA_DIR
if (profileOverride) app.setPath('userData', profileOverride)

// Registered at module top level: Finder fires open-file before 'ready', and
// a listener attached later would miss it entirely.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  finderOpenQueue = finderOpenQueue
    .then(async () => {
      await enqueuePath(filePath)
    })
    // One bad path must not stall every Finder open after it.
    .catch((error: unknown) => console.error('open-file failed', error))
})

// Scheme privileges are only accepted before ready, so this cannot wait for
// the whenReady block below.
registerImageScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // Files on the command line are routed to their own windows, which come
    // forward themselves. Launching again with nothing just surfaces the app,
    // unless it is still starting up and about to show its windows anyway.
    void enqueueArgv(argv).then((accepted) => {
      if (accepted > 0 || !hasStarted()) return
      const [win] = BrowserWindow.getAllWindows()
      if (win) raise(win)
      else restoreWindows()
    })
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
    setOpenDocumentLookup(documentShownBy)
    installImageProtocol()
    registerIpcHandlers()
    buildApplicationMenu()
    await finderOpenQueue
    await enqueueArgv(process.argv)
    startUp()

    // macOS: clicking the dock icon with no windows open reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) restoreWindows()
    })
  })

  app.on('before-quit', () => {
    setQuitting(true)
  })

  app.on('will-quit', () => {
    flushSettings()
    void closeAllWatchers()
  })

  // Closing the last window is a layout worth remembering, but an empty list
  // would wipe the session, so the final layout is captured before teardown.
  app.on('before-quit', () => {
    persistSessions()
  })

  app.on('window-all-closed', () => {
    // On macOS the app stays alive with no windows unless the user quits --
    // but if a quit was already in flight, honour it.
    if (process.platform !== 'darwin' || getQuitting()) app.quit()
  })
}
