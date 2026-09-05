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
  return resolved
}

export function grantRoot(dirPath: string): string {
  const resolved = validatePath(dirPath)
  grantedRoots.add(resolved)
  return resolved
}

const isInsideGrantedRoot = (target: string): boolean => {
  for (const root of grantedRoots) {
    if (target === root || target.startsWith(root + path.sep)) return true
  }
  return false
}

/**
 * Resolves symlinks so a granted path cannot be used to reach outside its
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

export async function assertReadable(input: unknown): Promise<string> {
  const target = validatePath(input)
  const real = await realResolve(target)
  const granted =
    grantedFiles.has(target) ||
    grantedFiles.has(real) ||
    isInsideGrantedRoot(target) ||
    isInsideGrantedRoot(real)
  if (!granted) throw new PathPermissionError()
  // The app only ever reads markdown-ish text.
  if (!isReadablePath(real)) {
    throw new PathPermissionError('EPERM: unsupported file type')
  }
  return target
}

export async function assertWritable(input: unknown): Promise<string> {
  const target = validatePath(input)
  const real = await realResolve(target)
  const granted =
    grantedFiles.has(target) ||
    grantedFiles.has(real) ||
    isInsideGrantedRoot(target) ||
    isInsideGrantedRoot(real)
  if (!granted) throw new PathPermissionError()
  // Writes may never produce an executable or config file.
  if (!isMarkdownPath(real)) {
    throw new PathPermissionError('EPERM: refusing to write a non-markdown file')
  }
  // Never let the renderer clobber our own settings.
  const userData = path.resolve(app.getPath('userData'))
  if (real === userData || real.startsWith(userData + path.sep)) {
    throw new PathPermissionError('EPERM: refusing to write inside userData')
  }
  return target
}

/** Directories are readable when granted as a root. */
export async function assertReadableDir(input: unknown): Promise<string> {
  const target = validatePath(input)
  const real = await realResolve(target)
  if (!isInsideGrantedRoot(target) && !isInsideGrantedRoot(real)) {
    throw new PathPermissionError()
  }
  return target
}
