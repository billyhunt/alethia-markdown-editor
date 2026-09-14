import fs from 'node:fs/promises'
import path from 'node:path'
import { net, protocol } from 'electron'
import { PathPermissionError, assertReadable, validatePath } from './paths.ts'
import { IMAGE_SCHEME, isRemoteSource } from '../shared/images.ts'

/**
 * How the renderer gets to see an image on disk.
 *
 * The renderer is sandboxed and its CSP allows no `file:` images, so a
 * document's `![](photo.png)` cannot simply be turned into a file URL. This
 * scheme sits in between. A request names the *document* the image belongs to
 * and the *source* as written in that document; main decides whether to serve
 * anything.
 *
 * The rule: the document has to be one the user opened (so it is in the grant
 * registry), and the image has to resolve to somewhere inside that document's
 * own directory. Opening a markdown file is taken as consent to see the images
 * it references beside it, and nothing further -- `../` out of the folder,
 * an absolute path elsewhere on disk, or a symlink pointing out are all
 * refused. Only image extensions are served, so this cannot be used to read
 * arbitrary text files either.
 */

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
  '.ico',
])

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

/** Anything larger is refused rather than decoded; a 1 GB PNG is not a note. */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024

export interface ResolvedImage {
  /** Absolute, real path of the image to read. */
  filePath: string
  mimeType: string
}

/**
 * Pure resolution: from a request URL to the file it may read, or a reason it
 * may not. `isReadableDoc` is injected so this can be tested without Electron
 * and so the grant decision stays in `paths.ts`.
 */
export async function resolveImageRequest(
  requestUrl: string,
  isReadableDoc: (docPath: string) => Promise<string>,
  realpath: (p: string) => Promise<string> = (p) => fs.realpath(p),
): Promise<ResolvedImage> {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    throw new PathPermissionError('EINVAL: malformed image request')
  }
  if (url.protocol !== `${IMAGE_SCHEME}:`) {
    throw new PathPermissionError('EINVAL: wrong scheme')
  }

  const doc = url.searchParams.get('doc')
  const src = url.searchParams.get('src')
  if (!doc || !src) throw new PathPermissionError('EINVAL: image request needs doc and src')

  // Remote and data URLs are the renderer's business (and the CSP's); this
  // scheme only ever reads the disk.
  if (isRemoteSource(src)) {
    throw new PathPermissionError('EPERM: not a local image')
  }

  // The document itself has to be one the user opened. That is the consent
  // this whole scheme rests on.
  const docPath = await isReadableDoc(validatePath(doc))
  const docDir = path.dirname(docPath)

  // Resolve the way a browser would resolve a relative href: against the
  // document's directory. A leading slash is treated as absolute on disk,
  // which then has to fall inside docDir to be served, so `/etc/passwd`
  // style sources fail the containment check below rather than being
  // special-cased.
  const target = path.resolve(docDir, decodeURIComponent(src))

  const extension = path.extname(target).toLowerCase()
  const mimeType = MIME[extension]
  if (!IMAGE_EXTENSIONS.has(extension) || !mimeType) {
    throw new PathPermissionError('EPERM: not an image file')
  }

  // Containment is decided on real paths, so a symlink inside the folder
  // cannot point out of it.
  const [realDir, realTarget] = await Promise.all([realpath(docDir), realpath(target)])
  const relative = path.relative(realDir, realTarget)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathPermissionError('EPERM: image is outside the document folder')
  }

  return { filePath: realTarget, mimeType }
}

/**
 * Must run before `app.whenReady()`: Electron only accepts scheme privileges
 * during startup. `standard` gives the URL a host and a proper `URL` parse in
 * the renderer; `supportFetchAPI` lets `<img>` use it; `bypassCSP` is
 * deliberately NOT set, because the CSP names the scheme explicitly.
 */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** Installs the handler. Call once, after `app.whenReady()`. */
export function installImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    try {
      const { filePath, mimeType } = await resolveImageRequest(request.url, assertReadable)
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return new Response('not a file', { status: 404 })
      if (stat.size > MAX_IMAGE_BYTES) return new Response('image too large', { status: 413 })

      // net.fetch on a file URL streams from disk and sets Content-Length.
      const response = await net.fetch(`file://${encodeURI(filePath)}`)
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'no-store',
        },
      })
    } catch (error) {
      if (error instanceof PathPermissionError) {
        return new Response(error.message, { status: 403 })
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return new Response('not found', { status: 404 })
      return new Response('error', { status: 500 })
    }
  })
}

