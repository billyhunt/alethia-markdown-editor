import { app, ipcMain } from 'electron'
import { IPC } from '../shared/ipc.ts'
import type { RendererReadyResult } from '../shared/api.ts'

/**
 * Registers every ipcMain handler. Handlers always treat their arguments as
 * `unknown` and validate before use; later phases add path validation on top.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appRendererReady, (): RendererReadyResult => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
    }
  })
}
