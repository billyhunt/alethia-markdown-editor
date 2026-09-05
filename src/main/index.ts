import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window.ts'
import { registerIpcHandlers } from './ipc.ts'
import { hardenSession } from './security.ts'

// A second launch should focus the running app rather than start a rival
// instance. Later phases forward the new argv's file paths here.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    hardenSession()
    registerIpcHandlers()
    createMainWindow()

    // macOS: clicking the dock icon with no windows open reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
