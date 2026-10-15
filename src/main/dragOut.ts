import fs from 'node:fs/promises'
import path from 'node:path'
import { app, nativeImage, type NativeImage, type WebContents } from 'electron'
import { assertReadable, assertReadableDir } from './paths.ts'

/**
 * Drags a sidebar file or folder out of the window as a real file, so the
 * system decides what a drop means: Terminal and iTerm insert its escaped
 * path, Finder copies it, Mail attaches it.
 *
 * Only paths already granted to the app can leave, and only documents the
 * sidebar would list or folders: whether the path is a folder is decided
 * here, never taken from the renderer.
 */
export async function startPathDrag(contents: WebContents, target: unknown): Promise<string | null> {
  const input = (typeof target === 'object' && target !== null ? target : {}) as { path?: unknown }
  // The grant is checked before the path is touched at all.
  const granted = await assertReadableDir(input.path)
  const kind = (await fs.stat(granted)).isDirectory() ? 'dir' : 'file'
  const filePath = kind === 'dir' ? granted : await assertReadable(granted)
  if (contents.isDestroyed()) return null
  // The pointer is already moving, so the drag never waits on an icon lookup:
  // Finder's icon is used once it is known, a plain page until then.
  contents.startDrag({ file: filePath, icon: iconFor(filePath, kind) })
  // The grant check may have resolved the path; this is the one a drop back
  // on the window will carry.
  return filePath
}

// A 32px page, drawn rather than shipped as a file: startDrag on macOS needs a
// non-empty icon, and this one must exist before any lookup has finished.
const PAGE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAV0lEQVR4nO3UwQkAIAxDUefs/lP0ohN4aBNQ9Adyf5TQMcgmETE7tQIys1wboguwIRSABaECZIQDICFcgDYCwHWA6kd87wIA2AAANgCADQA4AnC2DPgmCyRJSSnQz7KaAAAAAElFTkSuQmCC'
let fallback: NativeImage | null = null

const icons = new Map<string, NativeImage>()
const lookups = new Set<string>()

/** Finder's icon for the kind of item, once known; the plain page until then. */
function iconFor(filePath: string, kind: 'file' | 'dir'): NativeImage {
  const key = kind === 'dir' ? '/' : path.extname(filePath).toLowerCase()
  const known = icons.get(key)
  if (known) return known
  if (!lookups.has(key)) {
    lookups.add(key)
    app
      .getFileIcon(filePath, { size: 'normal' })
      .then((icon) => {
        if (!icon.isEmpty()) icons.set(key, icon)
      })
      .catch(() => undefined)
      // A failed or empty lookup is tried again on the next drag.
      .finally(() => lookups.delete(key))
  }
  fallback ??= nativeImage.createFromDataURL(PAGE_ICON)
  return fallback
}
