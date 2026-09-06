import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc.ts'
import type { MarkdownApi, Unsubscribe } from '../shared/api.ts'

/**
 * The only file on the renderer side allowed to touch ipcRenderer.
 *
 * It holds no state and contains no logic beyond shaping calls into the
 * MarkdownApi contract; everything else lives in main or the renderer.
 */
const subscribe = <T,>(channel: string, cb: (payload: T) => void): Unsubscribe => {
  // The Electron event object never crosses the bridge -- callbacks get the
  // payload only.
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: MarkdownApi = {
  dialog: {
    openFile: () => ipcRenderer.invoke(IPC.dialogOpenFile),
    openFolder: () => ipcRenderer.invoke(IPC.dialogOpenFolder),
    saveAs: (opts) => ipcRenderer.invoke(IPC.dialogSaveAs, opts ?? {}),
    confirmSaveChanges: (opts) => ipcRenderer.invoke(IPC.dialogConfirmSaveChanges, opts),
    showError: (opts) => ipcRenderer.invoke(IPC.dialogShowError, opts),
  },
  fs: {
    readFile: (filePath) => ipcRenderer.invoke(IPC.fsReadFile, filePath),
    writeFile: (filePath, content, opts) =>
      ipcRenderer.invoke(IPC.fsWriteFile, filePath, content, opts ?? {}),
    stat: (filePath) => ipcRenderer.invoke(IPC.fsStat, filePath),
    rename: (filePath, name) => ipcRenderer.invoke(IPC.fsRename, filePath, name),
  },
  folder: {
    list: (root) => ipcRenderer.invoke(IPC.folderList, root),
    watch: (root) => ipcRenderer.invoke(IPC.folderWatch, root),
    unwatch: () => ipcRenderer.invoke(IPC.folderUnwatch),
  },
  document: {
    watch: (filePath) => ipcRenderer.invoke(IPC.docWatch, filePath),
    unwatch: () => ipcRenderer.invoke(IPC.docUnwatch),
  },
  recents: {
    list: () => ipcRenderer.invoke(IPC.recentsList),
    add: (filePath) => ipcRenderer.invoke(IPC.recentsAdd, filePath),
    clear: () => ipcRenderer.invoke(IPC.recentsClear),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    patch: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch),
  },
  window: {
    close: (opts) => ipcRenderer.invoke(IPC.windowClose, opts ?? {}),
    cancelClose: () => ipcRenderer.invoke(IPC.windowCancelClose),
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    isFullScreen: () => ipcRenderer.invoke(IPC.windowIsFullScreen),
    setDocument: (info) => ipcRenderer.invoke(IPC.windowSetDocument, info),
  },
  app: {
    rendererReady: () => ipcRenderer.invoke(IPC.appRendererReady),
    grantDroppedPath: (filePath) => ipcRenderer.invoke(IPC.appGrantDroppedPath, filePath),
  },
  versions: {
    list: (filePath) => ipcRenderer.invoke(IPC.versionsList, filePath),
    read: (filePath, id) => ipcRenderer.invoke(IPC.versionsRead, filePath, id),
    clear: (filePath) => ipcRenderer.invoke(IPC.versionsClear, filePath),
  },
  print: {
    exportPdf: (suggestedName) => ipcRenderer.invoke(IPC.printExportPdf, suggestedName),
  },
  menu: {
    fileContext: (target) => ipcRenderer.invoke(IPC.menuFileContext, target),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
    showItemInFolder: (filePath) => ipcRenderer.invoke(IPC.shellShowItemInFolder, filePath),
  },
  // File.path was removed from Electron; this is the supported replacement.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  on: {
    command: (cb) => subscribe(IPC.hostCommand, cb),
    openPath: (cb) => subscribe(IPC.hostOpenPath, cb),
    fileChanged: (cb) => subscribe(IPC.hostFileChanged, cb),
    folderTree: (cb) => subscribe(IPC.hostFolderTree, cb),
    closeRequested: (cb) => subscribe(IPC.hostCloseRequested, cb),
    fullScreenChanged: (cb) => subscribe(IPC.hostFullScreenChanged, cb),
  },
}

contextBridge.exposeInMainWorld('api', api)
