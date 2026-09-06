import fs from 'node:fs/promises'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC } from '../shared/ipc.ts'
import { isReadablePath } from '../shared/markdown.ts'
import { readTextFile, renameFile, statPath, writeTextFile } from './files.ts'
import { listMarkdownTree } from './folder.ts'
import {
  confirmSaveChanges,
  showError,
  showOpenFile,
  showOpenFolder,
  showSaveAs,
} from './dialogs.ts'
import { getSettings, patchSettings } from './settings.ts'
import { addRecent, clearRecents, listRecents } from './recents.ts'
import { grantFile, grantRoot, validatePath } from './paths.ts'
import { takePendingPaths } from './openWith.ts'
import { markForceClose, setQuitting } from './window.ts'
import { showFileContextMenu } from './fileMenu.ts'
import { exportPdf } from './printing.ts'
import { unwatchDocument, unwatchFolder, watchDocument, watchFolder } from './watcher.ts'
import type {
  DocumentInfo,
  OpenPathEvent,
  RendererReadyResult,
  SaveAsOptions,
  WriteFileOptions,
} from '../shared/api.ts'

const winOf = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender)

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  return value
}

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/**
 * Every handler treats its arguments as unknown and validates before use.
 * Path arguments additionally go through the grant registry in paths.ts.
 */
export function registerIpcHandlers(): void {
  // --- dialogs -------------------------------------------------------------
  ipcMain.handle(IPC.dialogOpenFile, (event) => showOpenFile(winOf(event)))
  ipcMain.handle(IPC.dialogOpenFolder, (event) => showOpenFolder(winOf(event)))
  ipcMain.handle(IPC.dialogSaveAs, (event, opts: unknown) =>
    showSaveAs(winOf(event), asObject(opts) as SaveAsOptions),
  )
  ipcMain.handle(IPC.dialogConfirmSaveChanges, (event, opts: unknown) =>
    confirmSaveChanges(winOf(event), asString(asObject(opts).fileName, 'fileName')),
  )
  ipcMain.handle(IPC.dialogShowError, (event, opts: unknown) => {
    const o = asObject(opts)
    return showError(winOf(event), asString(o.title, 'title'), asString(o.message, 'message'))
  })

  // --- file system ---------------------------------------------------------
  ipcMain.handle(IPC.fsReadFile, (_event, filePath: unknown) => readTextFile(filePath))
  ipcMain.handle(IPC.fsWriteFile, (_event, filePath: unknown, content: unknown, opts: unknown) =>
    writeTextFile(filePath, content, asObject(opts) as WriteFileOptions),
  )
  ipcMain.handle(IPC.fsStat, (_event, filePath: unknown) => statPath(filePath))
  ipcMain.handle(IPC.fsRename, (_event, filePath: unknown, name: unknown) =>
    renameFile(filePath, name),
  )

  // --- folder --------------------------------------------------------------
  ipcMain.handle(IPC.folderList, (_event, root: unknown) => listMarkdownTree(root))
  ipcMain.handle(IPC.folderWatch, async (_event, root: unknown) => {
    const target = validatePath(root)
    patchSettings({ lastFolder: target })
    await watchFolder(target)
  })
  ipcMain.handle(IPC.folderUnwatch, () => unwatchFolder())

  // --- document watch ------------------------------------------------------
  ipcMain.handle(IPC.docWatch, async (_event, filePath: unknown) => {
    const target = validatePath(filePath)
    patchSettings({ lastFile: target })
    await watchDocument(target)
  })
  ipcMain.handle(IPC.docUnwatch, () => unwatchDocument())

  // --- recents -------------------------------------------------------------
  ipcMain.handle(IPC.recentsList, () => listRecents())
  ipcMain.handle(IPC.recentsAdd, (_event, filePath: unknown) => addRecent(filePath))
  ipcMain.handle(IPC.recentsClear, () => clearRecents())

  // --- settings ------------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsPatch, (_event, patch: unknown) => patchSettings(asObject(patch)))

  // --- window --------------------------------------------------------------
  ipcMain.handle(IPC.windowClose, (event, opts: unknown) => {
    const win = winOf(event)
    if (!win) return
    // force is only ever passed after the renderer confirmed it is closable.
    if (asObject(opts).force === true) markForceClose(win)
    win.close()
  })
  ipcMain.handle(IPC.windowCancelClose, () => {
    // The renderer declined; a later Cmd+W must not silently quit the app.
    setQuitting(false)
  })
  ipcMain.handle(IPC.windowMinimize, (event) => winOf(event)?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const win = winOf(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IPC.windowIsFullScreen, (event) => winOf(event)?.isFullScreen() ?? false)
  ipcMain.handle(IPC.windowSetDocument, (event, info: unknown) => {
    const win = winOf(event)
    if (!win) return
    const { filePath, edited } = asObject(info) as unknown as DocumentInfo
    // Gives the title bar its proxy icon and the red traffic light its dot.
    win.setRepresentedFilename(typeof filePath === 'string' ? filePath : '')
    win.setDocumentEdited(edited === true)
    win.setTitle(
      typeof filePath === 'string' && filePath
        ? (filePath.split('/').pop() ?? 'Alethia')
        : 'Alethia',
    )
  })

  // --- app -----------------------------------------------------------------
  ipcMain.handle(IPC.appRendererReady, (): RendererReadyResult => {
    return {
      pendingPaths: takePendingPaths(),
      settings: getSettings(),
      platform: process.platform,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
    }
  })
  ipcMain.handle(IPC.appGrantDroppedPath, async (_event, filePath: unknown): Promise<OpenPathEvent> => {
    const target = validatePath(filePath)
    const stats = await fs.stat(target)
    if (stats.isDirectory()) return { path: grantRoot(target), kind: 'dir' }
    if (!isReadablePath(target)) throw new Error('EPERM: not a markdown file')
    return { path: grantFile(target), kind: 'file' }
  })

  // --- context menu --------------------------------------------------------
  ipcMain.handle(IPC.menuFileContext, (event, target: unknown) =>
    showFileContextMenu(winOf(event), target),
  )

  // --- printing ------------------------------------------------------------
  ipcMain.handle(IPC.printExportPdf, (event, suggestedName: unknown) =>
    exportPdf(winOf(event), suggestedName),
  )

  // --- shell ---------------------------------------------------------------
  ipcMain.handle(IPC.shellOpenExternal, (_event, url: unknown) => {
    const target = asString(url, 'url')
    if (!/^https?:\/\//.test(target)) throw new Error('EPERM: only http(s) URLs may be opened')
    return shell.openExternal(target)
  })
  ipcMain.handle(IPC.shellShowItemInFolder, (_event, filePath: unknown) => {
    shell.showItemInFolder(validatePath(filePath))
  })
}
