import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IGNORED_DIR_NAMES, isMarkdownPath } from '../shared/markdown.ts'
import { PathPermissionError, assertReadableDir, validatePath } from './paths.ts'
import type { FileNode, FolderTree } from '../shared/api.ts'

const MAX_DEPTH = 12
const MAX_ENTRIES = 20_000

const isIgnoredDir = (name: string): boolean =>
  name.startsWith('.') || IGNORED_DIR_NAMES.includes(name)

/**
 * Builds the sidebar tree for a workspace folder: markdown files only,
 * directories that contain none pruned away, symlinked directories not
 * followed (they can form cycles and escape the granted root).
 */
export async function listMarkdownTree(input: unknown): Promise<FolderTree> {
  const root = await assertReadableDir(input)
  let count = 0
  let truncated = false

  async function walk(dir: string, depth: number): Promise<FileNode[]> {
    if (depth > MAX_DEPTH || truncated) return []

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return [] // unreadable directory; skip rather than fail the whole scan
    }

    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (count >= MAX_ENTRIES) {
        truncated = true
        break
      }
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue
        const children = await walk(full, depth + 1)
        // Prune directories with no markdown anywhere beneath them.
        if (children.length > 0) {
          nodes.push({ name: entry.name, path: full, kind: 'dir', children })
        }
      } else if (entry.isFile() && isMarkdownPath(entry.name)) {
        count += 1
        nodes.push({ name: entry.name, path: full, kind: 'file' })
      }
    }

    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return nodes
  }

  const children = await walk(root, 0)
  return {
    root,
    tree: { name: path.basename(root), path: root, kind: 'dir', children },
    truncated,
  }
}

/**
 * Whether a folder is somewhere nobody means to open by opening one file in
 * it: the home folder, a filesystem root, or a mounted volume's top level.
 * Compared on real paths, so `/Volumes/Macintosh HD` (which is `/`) and the
 * `/var` aliases are caught.
 */
export async function isBroadRoot(real: string): Promise<boolean> {
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir())
  return real === home || path.parse(real).root === real || path.dirname(real) === '/Volumes'
}

/**
 * The sidebar tree for a folder the app chose to show on its own, because a
 * file was opened from it. Resolves null, not an error, when the folder is not
 * one to show: main never granted it (a file-only grant, a symlink's real
 * parent, a linked file outside the open folders) or it is too broad to adopt
 * silently. Every other failure still throws, so the caller can report it.
 * Explicitly opened folders go through listMarkdownTree and are not limited.
 */
export async function listImplicitFolder(input: unknown): Promise<FolderTree | null> {
  const target = validatePath(input)
  let granted: string
  try {
    granted = await assertReadableDir(target)
  } catch (error) {
    if (error instanceof PathPermissionError) return null
    throw error
  }
  if (await isBroadRoot(await fs.realpath(granted))) return null
  return listMarkdownTree(granted)
}
