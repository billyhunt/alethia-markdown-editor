import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// images.ts imports electron for the protocol handler; the resolver under
// test never touches it.
vi.mock('electron', () => ({ net: {}, protocol: {}, app: { getPath: () => '/tmp' } }))

const { resolveImageRequest, MAX_IMAGE_BYTES } = await import('../../src/main/images.ts')
const { imageRequestUrl } = await import('../../src/shared/images.ts')
const { PathPermissionError } = await import('../../src/main/paths.ts')

let root = ''
let notes = ''
let doc = ''

/**
 * Stands in for the grant registry: the document under `notes/` is the one
 * the user opened; anything else was not.
 */
const readableDoc = async (p: string): Promise<string> => {
  if (p === doc) return doc
  throw new PathPermissionError()
}

beforeEach(async () => {
  root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'alethia-images-')))
  notes = path.join(root, 'notes')
  await fsp.mkdir(path.join(notes, 'assets'), { recursive: true })
  await fsp.mkdir(path.join(root, 'elsewhere'))
  doc = path.join(notes, 'note.md')
  await fsp.writeFile(doc, '# note')
  await fsp.writeFile(path.join(notes, 'photo.png'), 'png')
  await fsp.writeFile(path.join(notes, 'assets', 'diagram.svg'), '<svg/>')
  await fsp.writeFile(path.join(notes, 'secrets.txt'), 'hunter2')
  await fsp.writeFile(path.join(root, 'elsewhere', 'outside.png'), 'png')
})

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true })
})

const resolve = (src: string, forDoc = doc) =>
  resolveImageRequest(imageRequestUrl(forDoc, src), readableDoc)

describe('images the scheme serves', () => {
  it('serves an image beside the document', async () => {
    await expect(resolve('photo.png')).resolves.toEqual({
      filePath: path.join(notes, 'photo.png'),
      mimeType: 'image/png',
    })
  })

  it('serves an image in a subfolder of the document', async () => {
    await expect(resolve('assets/diagram.svg')).resolves.toMatchObject({
      filePath: path.join(notes, 'assets', 'diagram.svg'),
      mimeType: 'image/svg+xml',
    })
  })

  it('accepts ./ and percent-encoded sources the way a browser would', async () => {
    await expect(resolve('./photo.png')).resolves.toMatchObject({ mimeType: 'image/png' })
    await fsp.writeFile(path.join(notes, 'my photo.png'), 'png')
    await expect(resolve('my%20photo.png')).resolves.toMatchObject({
      filePath: path.join(notes, 'my photo.png'),
    })
  })

  it('exposes a size cap the handler enforces', () => {
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(1024 * 1024)
  })
})

describe('images the scheme refuses', () => {
  it('refuses a source that climbs out of the document folder', async () => {
    // The whole consent model is "you opened this file, you may see what is
    // beside it". `../` is the obvious way out.
    await expect(resolve('../elsewhere/outside.png')).rejects.toThrow(/outside the document folder/)
  })

  it('refuses an absolute path elsewhere on disk', async () => {
    await expect(resolve(path.join(root, 'elsewhere', 'outside.png'))).rejects.toThrow(
      /outside the document folder/,
    )
  })

  it('refuses a symlink inside the folder that points out of it', async () => {
    // Containment is decided on real paths precisely for this case.
    await fsp.symlink(path.join(root, 'elsewhere', 'outside.png'), path.join(notes, 'link.png'))
    await expect(resolve('link.png')).rejects.toThrow(/outside the document folder/)
  })

  it('refuses a document the user never opened', async () => {
    // A renderer that named some other file as the "document" would
    // otherwise be able to read images beside anything on disk.
    const stranger = path.join(root, 'elsewhere', 'other.md')
    await expect(resolve('outside.png', stranger)).rejects.toThrow(PathPermissionError)
  })

  it('refuses non-image files even inside the folder', async () => {
    // Without this the scheme is a general file reader wearing an <img> tag.
    await expect(resolve('secrets.txt')).rejects.toThrow(/not an image file/)
    await expect(resolve('note.md')).rejects.toThrow(/not an image file/)
  })

  it('refuses a source with a scheme; those are the CSP\u2019s business', async () => {
    await expect(resolve('https://example.com/a.png')).rejects.toThrow(/not a local image/)
    await expect(resolve('file:///etc/hosts')).rejects.toThrow(/not a local image/)
    await expect(resolve('data:image/png;base64,AAAA')).rejects.toThrow(/not a local image/)
  })

  it('refuses malformed requests', async () => {
    await expect(resolveImageRequest('not a url', readableDoc)).rejects.toThrow(/malformed/)
    await expect(resolveImageRequest('https://x/?doc=a&src=b', readableDoc)).rejects.toThrow(
      /wrong scheme/,
    )
    await expect(
      resolveImageRequest('alethia-image://local/?doc=/x.md', readableDoc),
    ).rejects.toThrow(/needs doc and src/)
  })

  it('reports a missing image as not found rather than as forbidden', async () => {
    // The handler maps ENOENT to 404, so the widget can say "not found"
    // instead of implying the user did something wrong.
    await expect(resolve('nope.png')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
