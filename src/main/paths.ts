import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { isMarkdownPath, isReadablePath } from '../shared/markdown.ts'

/**
 * Main never trusts a renderer-supplied path on its own.
 *
 * A path becomes *granted* only when it came from a source main controls: an
 * open/save dialog result, an `open-file` event, argv, a validated drop, or a
 * folder the user opened (which grants its whole subtree). Everything else is
 * refused, so a compromised renderer cannot read or overwrite arbitrary files.
 */
const grantedFiles = new Set<string>()
const grantedRoots = new Set<string>()

export class PathPermissionError extends Error {
  constructor(message = 'EPERM: path not permitted') {
    super(message)
    this.name = 'PathPermissionError'
  }
}

/** Shape check only: absolute, a string, no NUL bytes. */
export function validatePath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new PathPermissionError('EINVAL: not a valid path')
  }
  if (!path.isAbsolute(input)) {
    throw new PathPermissionError('EINVAL: path must be absolute')
  }
  return path.resolve(input)
}

export function grantFile(filePath: string): string {
  const resolved = validatePath(filePath)
  grantedFiles.add(resolved)
  realCache.delete(resolved)
  return resolved
}

export function grantRoot(dirPath: string): string {
  const resolved = validatePath(dirPath)
  grantedRoots.add(resolved)
  realCache.delete(resolved)
  return resolved
}

/**
 * Symlinks are resolved so a granted path cannot be used to reach outside its
 * root. For files that do not exist yet (Save As into a new name) the nearest
 * existing ancestor is realpath'd instead.
 */
async function realResolve(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch {
    const parent = path.dirname(target)
    try {
      return path.join(await fs.realpath(parent), path.basename(target))
    } catch {
      return target
    }
  }
}

const realCache = new Map<string, string>()

async function realOf(target: string): Promise<string> {
  const hit = realCache.get(target)
  if (hit !== undefined) return hit
  const resolved = await realResolve(target)
  realCache.set(target, resolved)
  return resolved
}

/**
 * Membership is decided on the REAL path only.
 *
 * Accepting the literal path as well would let a symlink sitting inside a
 * granted root grant access to whatever it points at, which is exactly the
 * escape the realpath is meant to close. Grants are resolved too, because a
 * root handed in as /var/... and a target resolving to /private/var/... are
 * the same directory on macOS and must compare equal.
 */
async function isGranted(real: string): Promise<boolean> {
  for (const filePath of grantedFiles) {
    if (real === filePath || real === (await realOf(filePath))) return true
  }
  for (const root of grantedRoots) {
    for (const candidate of [root, await realOf(root)]) {
      if (real === candidate || real.startsWith(candidate + path.sep)) return true
    }
  }
  return false
}

export async function assertReadable(input: unknown): Promise<string> {
  const target = validatePath(input)
  const real = await realResolve(target)
  if (!(await isGranted(real))) throw new PathPermissionError()
  // The app only ever reads markdown-ish text.
  if (!isReadablePath(real)) {
    throw new PathPermissionError('EPERM: unsupported file type')
  }
  return target
}

export async function assertWritable(input: unknown): Promise<string> {
  const target = validatePath(input)
  const real = await realResolve(target)
  if (!(await isGranted(real))) throw new PathPermissionError()
  // Writes may never produce an executable or config file.
  if (!isMarkdownPath(real)) {
    throw new PathPermissionError('EPERM: refusing to write a non-markdown file')
  }
  // Never let the renderer clobber our own settings. Resolved, because
  // getPath can hand back a path that traverses a symlink.
  const userData = await realOf(app.getPath('userData'))
  if (real === userData || real.startsWith(userData + path.sep)) {
    throw new PathPermissionError('EPERM: refusing to write inside userData')
  }
  return target
}

/** Directories are readable when granted as a root. */
export async function assertReadableDir(input: unknown): Promise<string> {
  const target = validatePath(input)
  const real = await realResolve(target)
  if (!(await isGranted(real))) throw new PathPermissionError()
  return target
}
