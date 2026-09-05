import fs from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import { IPC } from '../shared/ipc.ts'
import { IGNORED_DIR_NAMES, isMarkdownPath } from '../shared/markdown.ts'
import { getKnown, isSuppressed, rememberState } from './files.ts'
import { listMarkdownTree } from './folder.ts'
import { sendToRenderer, focusedWindow } from './commands.ts'
import type { FileChangeEvent } from '../shared/api.ts'

/**
 * chokidar rather than fs.watch: on macOS fs.watch reports duplicate and
 * rename-flavoured events for the temp-then-rename saves other editors do,
 * fires before the write finishes, and offers no debounce.
 */
let docWatcher: FSWatcher | null = null
let folderWatcher: FSWatcher | null = null
let folderDebounce: NodeJS.Timeout | null = null

export async function watchDocument(filePath: string): Promise<void> {
  await unwatchDocument()
  docWatcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })

  docWatcher.on('change', () => {
    void handleDocChange(filePath)
  })
  docWatcher.on('unlink', () => {
    emit({ path: filePath, kind: 'removed' })
  })
}

/**
 * Our own save must not look like an external edit. Three independent layers,
 * because macOS mtime resolution and chokidar's coalescing both vary:
 * a short suppression window after a write, an mtime+size comparison, and
 * finally a content hash.
 */
async function handleDocChange(filePath: string): Promise<void> {
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

  emit({ path: filePath, kind: 'changed', mtimeMs: stats.mtimeMs })
}

const emit = (event: FileChangeEvent): void => {
  sendToRenderer(focusedWindow(), IPC.hostFileChanged, event)
}

export async function unwatchDocument(): Promise<void> {
  await docWatcher?.close()
  docWatcher = null
}

export async function watchFolder(root: string): Promise<void> {
  await unwatchFolder()
  folderWatcher = chokidar.watch(root, {
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
    if (folderDebounce) clearTimeout(folderDebounce)
    folderDebounce = setTimeout(() => {
      void listMarkdownTree(root)
        .then((tree) => sendToRenderer(focusedWindow(), IPC.hostFolderTree, tree))
        .catch(() => undefined)
    }, 300)
  }

  folderWatcher.on('add', refresh)
  folderWatcher.on('unlink', refresh)
  folderWatcher.on('addDir', refresh)
  folderWatcher.on('unlinkDir', refresh)
}

export async function unwatchFolder(): Promise<void> {
  if (folderDebounce) {
    clearTimeout(folderDebounce)
    folderDebounce = null
  }
  await folderWatcher?.close()
  folderWatcher = null
}

export async function closeAllWatchers(): Promise<void> {
  await Promise.all([unwatchDocument(), unwatchFolder()])
}
