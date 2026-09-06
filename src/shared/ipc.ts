/**
 * Channel names and command vocabulary shared by main, preload and renderer.
 *
 * `erasableSyntaxOnly` is enabled (TypeScript 6), so these are `as const`
 * objects and string-literal unions rather than enums.
 */
export const IPC = {
  // renderer -> main (invoke / handle)
  dialogOpenFile: 'dialog:openFile',
  dialogOpenFolder: 'dialog:openFolder',
  dialogSaveAs: 'dialog:saveAs',
  dialogConfirmSaveChanges: 'dialog:confirmSaveChanges',
  dialogShowError: 'dialog:showError',
  fsReadFile: 'fs:readFile',
  fsWriteFile: 'fs:writeFile',
  fsStat: 'fs:stat',
  fsRename: 'fs:rename',
  folderList: 'folder:list',
  folderWatch: 'folder:watch',
  folderUnwatch: 'folder:unwatch',
  docWatch: 'doc:watch',
  docUnwatch: 'doc:unwatch',
  recentsList: 'recents:list',
  recentsAdd: 'recents:add',
  recentsClear: 'recents:clear',
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  windowClose: 'window:close',
  windowCancelClose: 'window:cancelClose',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowIsFullScreen: 'window:isFullScreen',
  windowSetDocument: 'window:setDocument',
  appRendererReady: 'app:rendererReady',
  appGrantDroppedPath: 'app:grantDroppedPath',
  menuFileContext: 'menu:fileContext',
  printExportPdf: 'print:exportPdf',
  versionsList: 'versions:list',
  versionsRead: 'versions:read',
  versionsClear: 'versions:clear',
  shellOpenExternal: 'shell:openExternal',
  shellShowItemInFolder: 'shell:showItemInFolder',

  // main -> renderer (send / on)
  hostCommand: 'host:command',
  hostOpenPath: 'host:openPath',
  hostFileChanged: 'host:fileChanged',
  hostFolderTree: 'host:folderTree',
  hostCloseRequested: 'host:closeRequested',
  hostFullScreenChanged: 'host:fullScreenChanged',
} as const

/** Commands the editor surface knows how to run. */
export type EditorCommand =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'paragraph'
  | 'blockquote'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'horizontalRule'

/** Commands the native menu dispatches into the renderer. */
export type HostCommand =
  | 'file:new'
  | 'file:open'
  | 'file:openFolder'
  | 'file:save'
  | 'file:saveAs'
  | 'file:close'
  | 'file:revealInFinder'
  | 'file:print'
  | 'file:exportPdf'
  | 'view:toggleSidebar'
  | 'view:toggleToolbar'
  | 'view:toggleAutosave'
  | 'view:toggleFocusMode'
  | 'view:toggleTypewriterMode'
  | `edit:${'undo' | 'redo'}`
  | `format:${Exclude<EditorCommand, 'undo' | 'redo'>}`
