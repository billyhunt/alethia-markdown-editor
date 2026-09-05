/** File extensions the app is willing to open and save. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'] as const

/** Also openable, but never offered as a save target by default. */
export const READABLE_EXTENSIONS = [...MARKDOWN_EXTENSIONS, '.txt'] as const

/** Directory names never descended into when scanning a workspace folder. */
export const IGNORED_DIR_NAMES = ['node_modules', '.git', 'dist', 'build', 'release']

const lowerExt = (filePath: string): string => {
  const dot = filePath.lastIndexOf('.')
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return dot > slash ? filePath.slice(dot).toLowerCase() : ''
}

export function isMarkdownPath(filePath: string): boolean {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(lowerExt(filePath))
}

export function isReadablePath(filePath: string): boolean {
  return (READABLE_EXTENSIONS as readonly string[]).includes(lowerExt(filePath))
}
