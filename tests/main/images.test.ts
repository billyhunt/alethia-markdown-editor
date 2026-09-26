import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerImageProtocol, resolveRelativeImagePath } from '../../src/main/images.ts'
import { grantRoot } from '../../src/main/paths.ts'
import { imageProtocolUrl } from '../../src/shared/images.ts'

let handler: ((request: { url: string }) => Promise<Response>) | null = null

vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'alethia-image-userdata') },
  protocol: {
    handle: (_scheme: string, next: (request: { url: string }) => Promise<Response>) => {
      handler = next
    },
    registerSchemesAsPrivileged: vi.fn(),
  },
}))

let root: string
let documentPath: string

function requestImage(url: string): Promise<Response> {
  if (!handler) throw new Error('image protocol handler was not registered')
  return handler({ url })
}


beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-image-'))
  documentPath = path.join(root, 'note.md')
  await fs.writeFile(documentPath, '# note')
  await fs.writeFile(path.join(root, 'diagram.png'), 'image bytes')
  grantRoot(root)
  registerImageProtocol()
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('relative image protocol', () => {
  it('resolves only relative targets from the document directory', () => {
    expect(resolveRelativeImagePath(documentPath, 'diagram.png')).toBe(path.join(root, 'diagram.png'))
    expect(resolveRelativeImagePath(documentPath, 'https://example.com/diagram.png')).toBeNull()
    expect(resolveRelativeImagePath(documentPath, '/tmp/diagram.png')).toBeNull()
  })

  it('serves a granted local image with its MIME type', async () => {
    const response = await requestImage(imageProtocolUrl(documentPath, 'diagram.png'))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('image/png')
    await expect(response?.text()).resolves.toBe('image bytes')
  })

  it('refuses an image that escapes the granted workspace', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-image-other-'))
    const escaped = path.relative(root, path.join(other, 'secret.png'))
    await fs.writeFile(path.join(other, 'secret.png'), 'secret')
    const response = await requestImage(imageProtocolUrl(documentPath, escaped))
    expect(response?.status).toBe(404)
    await fs.rm(other, { recursive: true, force: true })
  })
})
