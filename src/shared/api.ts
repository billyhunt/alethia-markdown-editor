/**
 * The contract between renderer and main.
 *
 * Compiled into BOTH TypeScript projects, so it holds types only -- never a
 * runtime import of `electron` or of DOM globals.
 */
import type { HostCommand } from './ipc'
import type { Settings, SettingsPatch, WindowSession } from './settings'

export type Unsubscribe = () => void
export type PathKind = 'file' | 'dir'

export interface FileNode {
  name: string
  /** Absolute path. */
  path: string
  kind: PathKind
  /** Directories only, already pruned to those containing markdown. */
  children?: FileNode[]
}

export interface FolderTree {
  root: string
  tree: FileNode
  /** True when the entry cap was hit and the tree is incomplete. */
  truncated: boolean
}

/** Line endings are preserved per file rather than normalised on save. */
export type LineEnding = '\n' | '\r\n'

export interface ReadFileResult {
  path: string
  /** UTF-8, BOM stripped, normalised to LF for the editor. */
  content: string
  /** What the file actually used, so a save can restore it. */
  lineEnding: LineEnding
  mtimeMs: number
}

export interface WriteFileOptions {
  /** The mtime the renderer last saw. Null or undefined skips the check. */
  expectedMtimeMs?: number | null
  /** Write even though the file changed on disk since it was loaded. */
  force?: boolean
  /** Restored on write; defaults to LF for a document with no origin. */
  lineEnding?: LineEnding
}

export type WriteFileResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; reason: 'conflict'; diskMtimeMs: number }

export interface StatResult {
  kind: PathKind
  mtimeMs: number
  size: number
}

export interface CreateFileOptions {
  /** A granted directory. Null or omitted uses the app's default folder. */
  dir?: string | null
  /** A basename, not a path. A markdown extension is added if missing. */
  name: string
  /** Written as part of creating the file, so no empty file can be left. */
  content?: string
  lineEnding?: LineEnding
}

export interface CreateFileResult {
  /** The path actually created, which may be numbered. */
  path: string
  mtimeMs: number
}

export type SaveChangesChoice = 'save' | 'dontSave' | 'cancel'

export interface SaveAsOptions {
  suggestedName?: string
  defaultDir?: string | null
}

export type FileChangeEvent =
  | { path: string; kind: 'changed'; mtimeMs: number }
  | { path: string; kind: 'removed' }

export interface OpenPathEvent {
  path: string
  kind: PathKind
}

export interface CloseRequestedEvent {
  reason: 'close' | 'quit'
}

export interface RendererReadyResult {
  /** Queued open-with paths from open-file / argv / second-instance. */
  pendingPaths: OpenPathEvent[]
  /** What this particular window should restore. */
  session: WindowSession
  settings: Settings
  platform: string
  version: string
  isPackaged: boolean
}

/** What the file context menu did, so the renderer can react. */
export type FileContextResult =
  | { action: 'cancelled' }
  | { action: 'revealed' }
  | { action: 'copiedPath' }
  /** Main does not rename; the sidebar edits the name in place. */
  | { action: 'rename'; path: string }
  /** Show this file's version history, which lives in the renderer. */
  | { action: 'history'; path: string }
  | { action: 'trashed'; path: string }

/** What the workspace switcher menu was asked to do. */
export type FolderSwitcherResult =
  | { action: 'cancelled' }
  /** Adopt this already-granted folder as the workspace. */
  | { action: 'switch'; path: string }
  /** Show the directory dialog instead. */
  | { action: 'open' }
  | { action: 'cleared' }

/** One past state of a document, newest first in listings. */
export interface DocumentVersion {
  /** Opaque; pass back to read a version. */
  id: string
  /** Epoch milliseconds. */
  savedAt: number
  hash: string
  bytes: number
}

export interface DocumentInfo {
  filePath: string | null
  edited: boolean
}

export interface MarkdownApi {
  dialog: {
    /** Native open dialog filtered to markdown. Null on cancel. Grants the path. */
    openFile(): Promise<string | null>
    /** Native directory dialog. Null on cancel. Grants the whole subtree. */
    openFolder(): Promise<string | null>
    /** Native save dialog, forced to a markdown extension. Null on cancel. */
    saveAs(opts?: SaveAsOptions): Promise<string | null>
    /** macOS three-button sheet: Save / Don't Save / Cancel. */
    confirmSaveChanges(opts: { fileName: string }): Promise<SaveChangesChoice>
    showError(opts: { title: string; message: string }): Promise<void>
  }

  fs: {
    /** Rejects with EPERM when the path was never granted. */
    readFile(path: string): Promise<ReadFileResult>
    writeFile(path: string, content: string, opts?: WriteFileOptions): Promise<WriteFileResult>
    /** Null when the path does not exist. Requires a granted path. */
    stat(path: string): Promise<StatResult | null>
    /**
     * Renames within the same directory. `name` is a basename, not a path;
     * a markdown extension is enforced. Resolves the new absolute path.
     */
    rename(path: string, name: string): Promise<string>
    /**
     * Creates a markdown file holding `content` and grants it, numbering the
     * name if it is taken. Never overwrites; creation is exclusive.
     */
    createFile(opts: CreateFileOptions): Promise<CreateFileResult>
  }

  folder: {
    list(root: string): Promise<FolderTree>
    /** Replaces any previous folder watch. Emits on.folderTree. */
    watch(root: string): Promise<void>
    unwatch(): Promise<void>
  }

  document: {
    /** Replaces any previous document watch. Emits on.fileChanged. */
    watch(path: string): Promise<void>
    unwatch(): Promise<void>
  }

  recents: {
    list(): Promise<string[]>
    add(path: string): Promise<void>
    clear(): Promise<void>
    /** Workspace folders, newest first, with vanished ones already dropped. */
    listFolders(): Promise<string[]>
    addFolder(path: string): Promise<void>
    clearFolders(): Promise<void>
  }

  settings: {
    get(): Promise<Settings>
    /** Returns the merged result. */
    patch(patch: SettingsPatch): Promise<Settings>
  }

  window: {
    /** force skips the close-requested round trip; only after ensureClosable(). */
    close(opts?: { force?: boolean }): Promise<void>
    /** The renderer declined a close or quit; clears the quitting flag. */
    cancelClose(): Promise<void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    isFullScreen(): Promise<boolean>
    /** Sets title, represented filename (proxy icon) and the edited dot. */
    setDocument(info: DocumentInfo): Promise<void>
  }

  app: {
    /** Call once after listeners are registered. Flushes queued open-with paths. */
    rendererReady(): Promise<RendererReadyResult>
    /** Validates and grants a dropped path. Rejects non-markdown files. */
    grantDroppedPath(path: string): Promise<OpenPathEvent>
  }

  versions: {
    /** Past states of a file, newest first. */
    list(path: string): Promise<DocumentVersion[]>
    read(path: string, id: string): Promise<string>
    clear(path: string): Promise<void>
  }

  print: {
    /**
     * Renders the document to PDF using the print stylesheet and asks where
     * to save it. Resolves the written path, or null if cancelled.
     */
    exportPdf(suggestedName: string): Promise<string | null>
  }

  menu: {
    /**
     * Pops a native context menu for one sidebar row and performs the chosen
     * action in main. Resolves once the menu closes.
     */
    fileContext(target: { path: string; kind: PathKind }): Promise<FileContextResult>
    /**
     * Pops the workspace switcher: recent folders, plus Open Folder. Resolves
     * once the menu closes.
     */
    folderSwitcher(opts?: { current?: string | null }): Promise<FolderSwitcherResult>
  }

  shell: {
    /** http(s) only; anything else rejects. */
    openExternal(url: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
  }

  /** Synchronous; wraps electron.webUtils.getPathForFile for drag and drop. */
  getPathForFile(file: File): string

  on: {
    command(cb: (cmd: HostCommand) => void): Unsubscribe
    openPath(cb: (e: OpenPathEvent) => void): Unsubscribe
    fileChanged(cb: (e: FileChangeEvent) => void): Unsubscribe
    folderTree(cb: (t: FolderTree) => void): Unsubscribe
    closeRequested(cb: (e: CloseRequestedEvent) => void): Unsubscribe
    fullScreenChanged(cb: (isFullScreen: boolean) => void): Unsubscribe
    /** Recents are application-wide; every window hears about a change. */
    recentFoldersChanged(cb: (folders: string[]) => void): Unsubscribe
  }
}
