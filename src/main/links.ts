import path from 'node:path'
import { isReadablePath } from '../shared/markdown.ts'

/** Resolves only a relative URL path against the main-owned document path. */
export function resolveLinkedMarkdown(documentPath: string, href: string): string {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
    throw new Error('EINVAL: not a local file link')
  }
  const urlPath = href.split(/[?#]/, 1)[0]
  let decoded: string
  try { decoded = decodeURIComponent(urlPath) } catch { throw new Error('EINVAL: malformed link encoding') }
  if (!decoded || path.isAbsolute(decoded)) throw new Error('EPERM: absolute link paths are not accepted')
  return path.resolve(path.dirname(documentPath), decoded)
}

export interface LinkOpenActions {
  realPath(path: string): Promise<string | null>
  isGranted(path: string): Promise<boolean>
  existingWindow(path: string): { focus(): void } | null
  confirm(realPath: string, isLink: boolean): Promise<boolean>
  open(path: string): void
  missing(path: string): void
}

export async function openLinkedMarkdown(documentPath: string, href: string, actions: LinkOpenActions): Promise<void> {
  const target = resolveLinkedMarkdown(documentPath, href)
  const realTarget = await actions.realPath(target)
  if (!realTarget) { actions.missing(target); return }
  if (!isReadablePath(realTarget)) throw new Error('EPERM: linked file is not markdown')
  const existing = actions.existingWindow(realTarget)
  if (existing) { existing.focus(); return }
  const isLink = realTarget !== target
  if (!(await actions.isGranted(realTarget)) && !(await actions.confirm(realTarget, isLink))) return
  actions.open(realTarget)
}
