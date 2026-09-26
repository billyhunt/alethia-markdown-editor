import fs from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'
import { IMAGE_PROTOCOL, isRelativeImageTarget } from '../shared/images.ts'
import { assertReadable, assertReadableImage } from './paths.ts'

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/** Must run before Electron's ready event and only once. */
export function registerImageProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: IMAGE_PROTOCOL, privileges: { secure: true } }])
}

export function resolveRelativeImagePath(documentPath: string, target: string): string | null {
  if (!isRelativeImageTarget(target)) return null
  return path.resolve(path.dirname(documentPath), target)
}

async function readRelativeImage(documentPath: string, target: string): Promise<Response> {
  const document = await assertReadable(documentPath)
  const imagePath = resolveRelativeImagePath(document, target)
  if (!imagePath) return new Response(null, { status: 400 })

  const readableImage = await assertReadableImage(imagePath)
  const data = await fs.readFile(readableImage)
  const contentType = MIME_TYPES[path.extname(readableImage).toLowerCase()]
  return new Response(data, {
    headers: { 'content-type': contentType ?? 'application/octet-stream' },
  })
}

/**
 * The renderer may request only an image relative to a markdown document it
 * can already read. The grant registry independently authorizes the image.
 */
export function registerImageProtocol(): void {
  protocol.handle(IMAGE_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return new Response(null, { status: 404 })

      const documentPath = url.searchParams.get('document')
      const target = url.searchParams.get('target')
      if (!documentPath || !target) return new Response(null, { status: 400 })

      return await readRelativeImage(documentPath, target)
    } catch {
      // A broken or unauthorized image is an ordinary missing resource, not a
      // renderer-visible main-process error.
      return new Response(null, { status: 404 })
    }
  })
}
