import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc.ts'
import type { MarkdownApi, Unsubscribe } from '../shared/api.ts'

// This private invoke is available only to preload code. The page cannot
// read the value or call the IPC channel directly.
const dropTokenPromise = ipcRenderer.invoke(IPC.appPreloadToken) as Promise<string>

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
    createFile: (opts) => ipcRenderer.invoke(IPC.fsCreateFile, opts),
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
    listFolders: () => ipcRenderer.invoke(IPC.recentsListFolders),
    addFolder: (dirPath) => ipcRenderer.invoke(IPC.recentsAddFolder, dirPath),
    clearFolders: () => ipcRenderer.invoke(IPC.recentsClearFolders),
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
    settleOpen: () => ipcRenderer.invoke(IPC.windowSettleOpen),
    revealDocument: (filePath) => ipcRenderer.invoke(IPC.windowRevealDocument, filePath),
    releaseDocument: (filePath) => ipcRenderer.invoke(IPC.windowReleaseDocument, filePath),
    rerouteOpen: (filePath) => ipcRenderer.invoke(IPC.windowRerouteOpen, filePath),
  },
  app: {
    rendererReady: () => ipcRenderer.invoke(IPC.appRendererReady),
    grantDroppedPath: (file) => {
      const filePath = webUtils.getPathForFile(file)
      if (!filePath) return Promise.reject(new Error('EPERM: untrusted drop'))
      return dropTokenPromise.then((token) => ipcRenderer.invoke(IPC.appGrantDroppedPath, filePath, token))
    },
    openLinkedFile: (href, documentId) => ipcRenderer.invoke(IPC.appOpenLinkedFile, href, documentId),
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
    folderSwitcher: (opts) => ipcRenderer.invoke(IPC.menuFolderSwitcher, opts ?? {}),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
    showItemInFolder: (filePath) => ipcRenderer.invoke(IPC.shellShowItemInFolder, filePath),
  },
  on: {
    command: (cb) => subscribe(IPC.hostCommand, cb),
    openPath: (cb) => subscribe(IPC.hostOpenPath, cb),
    fileChanged: (cb) => subscribe(IPC.hostFileChanged, cb),
    folderTree: (cb) => subscribe(IPC.hostFolderTree, cb),
    closeRequested: (cb) => subscribe(IPC.hostCloseRequested, cb),
    fullScreenChanged: (cb) => subscribe(IPC.hostFullScreenChanged, cb),
    recentFoldersChanged: (cb) => subscribe(IPC.hostRecentFoldersChanged, cb),
  },
}

contextBridge.exposeInMainWorld('api', api)
