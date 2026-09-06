import fs from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc.ts'
import { IGNORED_DIR_NAMES, isMarkdownPath } from '../shared/markdown.ts'
import { getKnown, isSuppressed, rememberState } from './files.ts'
import { listMarkdownTree } from './folder.ts'
import type { FileChangeEvent } from '../shared/api.ts'

/**
 * chokidar rather than fs.watch: on macOS fs.watch reports duplicate and
 * rename-flavoured events for the temp-then-rename saves other editors do,
 * fires before the write finishes, and offers no debounce.
 *
 * Watchers belong to a window, not to the application. A single pair would
 * mean a second window opening a file silently cancelled the first window's
 * watch, and change events would arrive at whichever window happened to be
 * focused rather than the one actually showing the file.
 */
interface WindowWatchers {
  doc: FSWatcher | null
  folder: FSWatcher | null
  folderDebounce: NodeJS.Timeout | null
}

const perWindow = new Map<number, WindowWatchers>()

const watchersFor = (id: number): WindowWatchers => {
  let entry = perWindow.get(id)
  if (!entry) {
    entry = { doc: null, folder: null, folderDebounce: null }
    perWindow.set(id, entry)
  }
  return entry
}

/** Events go to the window that asked for the watch, never the focused one. */
const emit = (win: BrowserWindow, channel: string, payload: unknown): void => {
  if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

export async function watchDocument(win: BrowserWindow, filePath: string): Promise<void> {
  const entry = watchersFor(win.id)
  await entry.doc?.close()

  entry.doc = chokidar.watch(filePath, {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })

  entry.doc.on('change', () => {
    void handleDocChange(win, filePath)
  })
  entry.doc.on('unlink', () => {
    emit(win, IPC.hostFileChanged, { path: filePath, kind: 'removed' } satisfies FileChangeEvent)
  })
}

/**
 * Our own save must not look like an external edit. Three independent layers,
 * because macOS mtime resolution and chokidar's coalescing both vary:
 * a short suppression window after a write, an mtime+size comparison, and
 * finally a content hash.
 */
async function handleDocChange(win: BrowserWindow, filePath: string): Promise<void> {
  if (isSuppressed(filePath)) return

  let stats
  try {
    stats = await fs.stat(filePath)
  } catch {
    return
  }

  const previous = getKnown(filePath)
  if (previous && stats.mtimeMs === previous.mtimeMs && stats.size === previous.size) return

  try {
    const content = await fs.readFile(filePath, 'utf8')
    rememberState(filePath, content, stats.mtimeMs)
    // Identical content (a touch, or a metadata-only write) is not a change.
    if (previous && getKnown(filePath)?.hash === previous.hash) return
  } catch {
    return
  }

  emit(win, IPC.hostFileChanged, {
    path: filePath,
    kind: 'changed',
    mtimeMs: stats.mtimeMs,
  } satisfies FileChangeEvent)
}

export async function unwatchDocument(win: BrowserWindow): Promise<void> {
  const entry = perWindow.get(win.id)
  if (!entry) return
  await entry.doc?.close()
  entry.doc = null
}

export async function watchFolder(win: BrowserWindow, root: string): Promise<void> {
  const entry = watchersFor(win.id)
  await closeFolder(entry)

  entry.folder = chokidar.watch(root, {
    ignoreInitial: true,
    depth: 12,
    // chokidar 4+ dropped glob support: `ignored` must be a function or RegExp.
    ignored: (target: string, stats?: { isFile(): boolean }) => {
      const name = target.split('/').pop() ?? ''
      if (name.startsWith('.') || IGNORED_DIR_NAMES.includes(name)) return true
      return Boolean(stats?.isFile()) && !isMarkdownPath(target)
    },
  })

  const refresh = (): void => {
    if (entry.folderDebounce) clearTimeout(entry.folderDebounce)
    entry.folderDebounce = setTimeout(() => {
      void listMarkdownTree(root)
        .then((tree) => emit(win, IPC.hostFolderTree, tree))
        .catch(() => undefined)
    }, 300)
  }

  entry.folder.on('add', refresh)
  entry.folder.on('unlink', refresh)
  entry.folder.on('addDir', refresh)
  entry.folder.on('unlinkDir', refresh)
}

async function closeFolder(entry: WindowWatchers): Promise<void> {
  if (entry.folderDebounce) {
    clearTimeout(entry.folderDebounce)
    entry.folderDebounce = null
  }
  await entry.folder?.close()
  entry.folder = null
}

export async function unwatchFolder(win: BrowserWindow): Promise<void> {
  const entry = perWindow.get(win.id)
  if (entry) await closeFolder(entry)
}

/** Called when a window closes; its watchers must not outlive it. */
export async function closeWatchersFor(windowId: number): Promise<void> {
  const entry = perWindow.get(windowId)
  if (!entry) return
  perWindow.delete(windowId)
  await entry.doc?.close()
  await closeFolder(entry)
}

export async function closeAllWatchers(): Promise<void> {
  await Promise.all([...perWindow.keys()].map((id) => closeWatchersFor(id)))
}

/** How many windows currently hold watchers; used by the tests. */
export const watchedWindowCount = (): number => perWindow.size
