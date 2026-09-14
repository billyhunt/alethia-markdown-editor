import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, protocol } from 'electron'
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
 * The rule: the document has to be one the user opened AND has open right now
 * in a window, and the image has to resolve to somewhere inside that
 * document's own directory. Opening a note is taken as consent to see the
 * images beside it, for as long as it is open, and nothing further. `../` out
 * of the folder, an absolute path elsewhere on disk, a symlink pointing out,
 * and a symlink or hardlink to a non-image are all refused. Every decision is
 * made on real paths and on the final resolved file, and the bytes are read
 * from the same descriptor that was checked, so what is validated is what is
 * served.
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

/** The extension policy, applied to whatever path it is handed. */
function imageMime(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase()
  return IMAGE_EXTENSIONS.has(extension) ? (MIME[extension] ?? null) : null
}

/**
 * Turns a markdown destination into a filesystem-relative path. Markdown
 * allows `<my pic.png>` for names with spaces, `%20` escapes, and a `?query`
 * or `#fragment` that no file has; a browser resolving the same href would
 * strip all three. A literal `%` not forming an escape is kept as written,
 * which is also what a browser does.
 */
export function destinationToPath(src: string): string {
  let out = src.trim()
  if (out.startsWith('<') && out.endsWith('>')) out = out.slice(1, -1)
  out = out.replace(/[?#].*$/, '')
  try {
    return decodeURIComponent(out)
  } catch {
    return out
  }
}

/**
 * Pure resolution: from a request URL to the file it may read, or a reason it
 * may not. The two checks that depend on app state are injected so this can be
 * tested without Electron: `isReadableDoc` is the grant registry, and
 * `isOpenDoc` is whether a window currently shows that document.
 */
export async function resolveImageRequest(
  requestUrl: string,
  isReadableDoc: (docPath: string) => Promise<string>,
  isOpenDoc: (realDocPath: string) => Promise<boolean>,
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
  // this whole scheme rests on. The base is taken from the document's REAL
  // path: a granted document reached through a symlink elsewhere must not
  // make that elsewhere the image folder.
  await isReadableDoc(validatePath(doc))
  const realDoc = await realpath(doc)
  const docStat = await fs.stat(realDoc)
  if (!docStat.isFile()) {
    // A directory that happens to be named `notes.md` and was opened as a
    // folder would otherwise pass the extension check and make its parent
    // the image folder.
    throw new PathPermissionError('EPERM: document is not a file')
  }
  // Consent lasts while the note is open. Grants persist (recents are
  // re-granted at launch), and without this every folder that ever held a
  // recent note would stay readable for images for the life of the process.
  if (!(await isOpenDoc(realDoc))) {
    throw new PathPermissionError('EPERM: document is not open')
  }
  const realDir = path.dirname(realDoc)

  // Resolve the way a browser would resolve a relative href: against the
  // document's directory. A leading slash is treated as absolute on disk,
  // which then has to fall inside the folder to be served.
  const target = path.resolve(realDir, destinationToPath(src))

  // Extension policy on the name as written, so a request for `secrets.txt`
  // is refused before touching the disk...
  if (imageMime(target) === null) {
    throw new PathPermissionError('EPERM: not an image file')
  }

  // ...and again on the real file, so `photo.png -> secrets.txt` is refused
  // too. Containment is likewise decided on real paths, so a symlink inside
  // the folder cannot point out of it.
  const realTarget = await realpath(target)
  const mimeType = imageMime(realTarget)
  if (mimeType === null) {
    throw new PathPermissionError('EPERM: not an image file')
  }
  const relative = path.relative(realDir, realTarget)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PathPermissionError('EPERM: image is outside the document folder')
  }

  return { filePath: realTarget, mimeType }
}

/**
 * Reads the image the resolver approved. Opened once and then inspected and
 * read through that one descriptor, so a swap on disk between check and read
 * cannot substitute a different file, and the size cap applies to the bytes
 * actually returned.
 */
export async function readResolvedImage(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOTDIR' })
    if (stat.size > MAX_IMAGE_BYTES) throw Object.assign(new Error('too large'), { code: 'EFBIG' })
    const bytes = await handle.readFile()
    if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('too large'), { code: 'EFBIG' })
    return bytes
  } finally {
    await handle.close()
  }
}

/** Maps a failure to the status the widget can act on. Exported for tests. */
export function statusForError(error: unknown): number {
  if (error instanceof PathPermissionError) return 403
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404
  if (code === 'EFBIG') return 413
  return 500
}

/** Headers on every served image. */
const IMAGE_HEADERS = (mimeType: string): Record<string, string> => ({
  'Content-Type': mimeType,
  // Never guess a type from the bytes: the extension policy decided it.
  'X-Content-Type-Options': 'nosniff',
  // An SVG served here has an origin of its own. Should it ever be embedded
  // by something other than <img>, it gets no script and no fetch.
  'Content-Security-Policy': "default-src 'none'; sandbox",
  // Re-renders of the same image (scroll, print) reuse the bytes rather than
  // re-reading disk; a changed file has a new mtime and misses.
  'Cache-Control': 'private, max-age=60',
})

/**
 * The handler body, separate from `protocol.handle` so it can be tested with
 * the real resolver and real files and without Electron. Returns a standard
 * Response; the protocol layer passes it straight through.
 */
export async function serveImage(
  requestUrl: string,
  deps: {
    isReadableDoc: (docPath: string) => Promise<string>
    isOpenDoc: (realDocPath: string) => Promise<boolean>
  },
): Promise<Response> {
  try {
    const { filePath, mimeType } = await resolveImageRequest(
      requestUrl,
      deps.isReadableDoc,
      deps.isOpenDoc,
    )
    const bytes = await readResolvedImage(filePath)
    return new Response(new Uint8Array(bytes), { status: 200, headers: IMAGE_HEADERS(mimeType) })
  } catch (error) {
    const status = statusForError(error)
    const message = status === 500 ? 'error' : ((error as Error).message ?? 'refused')
    return new Response(message, { status, headers: { 'Content-Type': 'text/plain' } })
  }
}

/**
 * Whether any window currently shows this document, compared on real paths
 * because windows record the path as it was opened.
 */
async function isOpenInAWindow(realDocPath: string): Promise<boolean> {
  for (const win of BrowserWindow.getAllWindows()) {
    const shown = openDocumentPath(win)
    if (!shown) continue
    try {
      if ((await fs.realpath(shown)) === realDocPath) return true
    } catch {
      // A window whose file has vanished shows nothing servable.
    }
  }
  return false
}

/** Injected by windows.ts at startup; avoids a circular import. */
let openDocumentPath: (win: BrowserWindow) => string | null = () => null

export function setOpenDocumentLookup(lookup: (win: BrowserWindow) => string | null): void {
  openDocumentPath = lookup
}

/**
 * Must run before `app.whenReady()`: Electron only accepts scheme privileges
 * during startup. `standard` gives the URL a host and origin so it parses in
 * the renderer; `secure` keeps it out of mixed-content warnings. Nothing else:
 * `supportFetchAPI` would enable fetch/XHR, `stream` would enable media
 * elements, and `bypassCSP` would defeat the point. An `<img>` needs none of
 * those.
 */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

/** Installs the handler. Call once, after `app.whenReady()`. */
export function installImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (request) =>
    serveImage(request.url, { isReadableDoc: assertReadable, isOpenDoc: isOpenInAWindow }),
  )
}
