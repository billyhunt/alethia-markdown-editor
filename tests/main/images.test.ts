import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// images.ts imports electron for the protocol handler; nothing under test
// touches it.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, protocol: {} }))

const {
  MAX_IMAGE_BYTES, destinationToPath, openResolvedImage, resolveImageRequest, serveImage, statusForError,
} =
  await import('../../src/main/images.ts')
const { imageRequestUrl } = await import('../../src/shared/images.ts')
const { PathPermissionError } = await import('../../src/main/paths.ts')

let root = ''
let notes = ''
let doc = ''

/** A real, tiny PNG so a served response can be checked for its bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** Stands in for the grant registry: only `doc` was opened. */
const granted = new Set<string>()
const readableDoc = async (p: string): Promise<string> => {
  if (granted.has(p)) return p
  throw new PathPermissionError()
}
/** Stands in for the window list: which real document paths are showing. */
const open = new Set<string>()
const openDoc = async (real: string): Promise<boolean> => open.has(real)

beforeEach(async () => {
  root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'alethia-images-')))
  notes = path.join(root, 'notes')
  await fsp.mkdir(path.join(notes, 'assets'), { recursive: true })
  await fsp.mkdir(path.join(root, 'elsewhere'))
  doc = path.join(notes, 'note.md')
  await fsp.writeFile(doc, '# note')
  await fsp.writeFile(path.join(notes, 'photo.png'), PNG)
  await fsp.writeFile(path.join(notes, 'assets', 'diagram.svg'), '<svg/>')
  await fsp.writeFile(path.join(notes, 'secrets.txt'), 'hunter2')
  await fsp.writeFile(path.join(root, 'elsewhere', 'outside.png'), PNG)
  granted.clear()
  granted.add(doc)
  open.clear()
  open.add(doc)
})

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true })
})

const resolve = (src: string, forDoc = doc) =>
  resolveImageRequest(imageRequestUrl(forDoc, src), readableDoc, openDoc)
const serve = (src: string, forDoc = doc) =>
  serveImage(imageRequestUrl(forDoc, src), { isReadableDoc: readableDoc, isOpenDoc: openDoc })

describe('destinationToPath', () => {
  it('unwraps the angle-bracket form markdown uses for names with spaces', () => {
    expect(destinationToPath('<my pic.png>')).toBe('my pic.png')
  })
  it('decodes percent escapes', () => {
    expect(destinationToPath('my%20pic.png')).toBe('my pic.png')
  })
  it('drops a query or fragment, which no file has', () => {
    expect(destinationToPath('a.png?v=2')).toBe('a.png')
    expect(destinationToPath('sprite.svg#icon')).toBe('sprite.svg')
  })
  it('keeps a literal percent that is not an escape, as a browser does', () => {
    expect(destinationToPath('100%.png')).toBe('100%.png')
    expect(destinationToPath('50%discount.png')).toBe('50%discount.png')
  })
})

describe('images the scheme serves', () => {
  it('serves an image beside the document', async () => {
    await expect(resolve('photo.png')).resolves.toMatchObject({
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

  it('accepts markdown destination forms: ./, %20, <...>, ?query', async () => {
    await fsp.writeFile(path.join(notes, 'my photo.png'), PNG)
    for (const src of ['./photo.png', 'my%20photo.png', '<my photo.png>', 'photo.png?v=2']) {
      await expect(resolve(src), src).resolves.toMatchObject({ mimeType: 'image/png' })
    }
  })

  it('serves a file whose name starts with two dots', async () => {
    // `..cover.png` is a legal name inside the folder; a naive `..` prefix
    // check refused it as a traversal.
    await fsp.writeFile(path.join(notes, '..cover.png'), PNG)
    await expect(resolve('..cover.png')).resolves.toMatchObject({
      filePath: path.join(notes, '..cover.png'),
    })
  })

  it('serves a file whose name contains # and ?', async () => {
    // These are legal in filenames and were mangled when the path was turned
    // into a file: URL; reading through a descriptor has no such step.
    await fsp.writeFile(path.join(notes, 'fig #1?.png'), PNG)
    const response = await serve('fig%20%231%3F.png')
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
  })
})

describe('images the scheme refuses', () => {
  it('refuses an image reached through a symlinked directory that points out', async () => {
    await fsp.symlink(path.join(root, 'elsewhere'), path.join(notes, 'linked'))
    await expect(resolve('linked/outside.png')).rejects.toThrow(/outside the document folder/)
    expect((await serve('linked/outside.png')).status).toBe(403)
  })

  it('serves a symlink that stays inside the folder', async () => {
    await fsp.symlink(path.join(notes, 'photo.png'), path.join(notes, 'alias.png'))
    await expect(resolve('alias.png')).resolves.toMatchObject({
      filePath: path.join(notes, 'photo.png'),
    })
  })

  it('treats a source with leading whitespace and a scheme as remote', async () => {
    await expect(resolve(' https://example.com/a.png')).rejects.toThrow(/not a local image/)
  })

  it('refuses a source that climbs out of the document folder', async () => {
    await expect(resolve('../elsewhere/outside.png')).rejects.toThrow(/outside the document folder/)
  })

  it('refuses an absolute path elsewhere on disk', async () => {
    await expect(resolve(path.join(root, 'elsewhere', 'outside.png'))).rejects.toThrow(
      /outside the document folder/,
    )
  })

  it('refuses a symlink inside the folder that points out of it', async () => {
    await fsp.symlink(path.join(root, 'elsewhere', 'outside.png'), path.join(notes, 'link.png'))
    await expect(resolve('link.png')).rejects.toThrow(/outside the document folder/)
  })

  it('refuses a symlink named like an image that points at a non-image', async () => {
    // The extension policy has to hold on the real file, not the link name,
    // or the scheme is a general file reader wearing a .png.
    await fsp.symlink(path.join(notes, 'secrets.txt'), path.join(notes, 'photo2.png'))
    await expect(resolve('photo2.png')).rejects.toThrow(/not an image file/)
  })

  it('refuses a document the user never opened', async () => {
    const stranger = path.join(root, 'elsewhere', 'other.md')
    await fsp.writeFile(stranger, '')
    await expect(resolve('outside.png', stranger)).rejects.toThrow(PathPermissionError)
  })

  it('refuses a granted document that is not open in any window', async () => {
    // Grants persist (recents are re-granted at launch). Consent to see
    // images lasts only while the note is actually open.
    open.clear()
    await expect(resolve('photo.png')).rejects.toThrow(/not open/)
  })

  it('takes the image folder from the document\u2019s real path, not an alias', async () => {
    // A symlink elsewhere pointing at the granted note passes the grant
    // check (it resolves to a granted file). Its own directory must not
    // become the image folder.
    const alias = path.join(root, 'elsewhere', 'alias.md')
    await fsp.symlink(doc, alias)
    granted.add(alias)
    // Resolved against the real note's folder, `outside.png` does not exist
    // there, so this fails as not-found; the wrong behaviour would have
    // served /elsewhere/outside.png, which does exist.
    await expect(resolve('outside.png', alias)).rejects.toThrow(/ENOENT/)
    // ...while an image beside the real note is still fine through the alias.
    await expect(resolve('photo.png', alias)).resolves.toMatchObject({ mimeType: 'image/png' })
  })

  it('refuses a directory posing as a document', async () => {
    // A folder named notes.md opened as a root passes the extension check;
    // its parent must not become the image folder.
    const dir = path.join(root, 'folder.md')
    await fsp.mkdir(dir)
    granted.add(dir)
    open.add(dir)
    await expect(resolve('elsewhere/outside.png', dir)).rejects.toThrow(/not a file/)
  })

  it('refuses non-image files even inside the folder', async () => {
    await expect(resolve('secrets.txt')).rejects.toThrow(/not an image file/)
    await expect(resolve('note.md')).rejects.toThrow(/not an image file/)
  })

  it('refuses a source with a scheme; those are the CSP\u2019s business', async () => {
    await expect(resolve('https://example.com/a.png')).rejects.toThrow(/not a local image/)
    await expect(resolve('file:///etc/hosts')).rejects.toThrow(/not a local image/)
    await expect(resolve('data:image/png;base64,AAAA')).rejects.toThrow(/not a local image/)
  })

  it('refuses malformed requests', async () => {
    await expect(resolveImageRequest('not a url', readableDoc, openDoc)).rejects.toThrow(/malformed/)
    await expect(
      resolveImageRequest('https://x/?doc=a&src=b', readableDoc, openDoc),
    ).rejects.toThrow(/wrong scheme/)
    await expect(
      resolveImageRequest('alethia-image://local/?doc=/x.md', readableDoc, openDoc),
    ).rejects.toThrow(/needs doc and src/)
  })
})

describe('the open that follows the check', () => {
  it('refuses a symlink swapped in after the path was validated', async () => {
    // The validation is of a path; whatever occupies it at open time is what
    // would be read. Swap the checked file for a link to a file outside.
    const resolved = await resolve('photo.png')
    await fsp.rm(resolved.filePath)
    await fsp.symlink(path.join(root, 'elsewhere', 'outside.png'), resolved.filePath)
    await expect(openResolvedImage(resolved)).rejects.toMatchObject({ code: 'ELOOP' })
  })

  it('refuses a different file swapped in at the validated path', async () => {
    const resolved = await resolve('photo.png')
    const impostor = path.join(notes, 'impostor.png')
    await fsp.writeFile(impostor, 'not the validated file')
    await fsp.rename(impostor, resolved.filePath)
    await expect(openResolvedImage(resolved)).rejects.toThrow(/changed after it was checked/)
  })

  it('refuses a validated directory swapped for a symlink to another', async () => {
    // The final component stays a regular file, so O_NOFOLLOW alone passes;
    // the identity check is what catches a parent that now leads elsewhere.
    await fsp.writeFile(path.join(notes, 'assets', 'photo.png'), PNG)
    await fsp.writeFile(path.join(root, 'elsewhere', 'photo.png'), 'other bytes')
    const resolved = await resolve('assets/photo.png')
    await fsp.rename(path.join(notes, 'assets'), path.join(notes, 'assets-moved'))
    await fsp.symlink(path.join(root, 'elsewhere'), path.join(notes, 'assets'))
    await expect(openResolvedImage(resolved)).rejects.toThrow(/changed after it was checked/)
  })

  it('streams the validated file untouched', async () => {
    const { body, size } = await openResolvedImage(await resolve('photo.png'))
    expect(size).toBe(PNG.length)
    expect(Buffer.from(await new Response(body).arrayBuffer())).toEqual(PNG)
  })

  it('streams a file larger than one chunk without altering it', async () => {
    const big = Buffer.alloc(700 * 1024)
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251
    await fsp.writeFile(path.join(notes, 'big.png'), big)
    const { body } = await openResolvedImage(await resolve('big.png'))
    expect(Buffer.from(await new Response(body).arrayBuffer())).toEqual(big)
  })

  it('stops a file that grows after it was measured instead of serving the excess', async () => {
    const resolved = await resolve('photo.png')
    const { body } = await openResolvedImage(resolved)
    await fsp.appendFile(resolved.filePath, Buffer.alloc(1024, 1))
    await expect(new Response(body).arrayBuffer()).rejects.toThrow(/grew/)
  })

  it('releases the file when the reader gives up', async () => {
    const { body } = await openResolvedImage(await resolve('photo.png'))
    await body.cancel()
    // A second cancel must not double-close.
    await expect(body.cancel()).resolves.toBeUndefined()
  })
})

describe('serveImage: the handler boundary', () => {
  it('is never served from a cache, so an edited image shows its new pixels', async () => {
    const response = await serve('photo.png')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Length')).toBe(String(PNG.length))
    await fsp.writeFile(path.join(notes, 'photo.png'), 'edited')
    expect(await (await serve('photo.png')).text()).toBe('edited')
  })

  it('refuses an image with 403 once its document is not open', async () => {
    open.clear()
    expect((await serve('photo.png')).status).toBe(403)
  })

  it('refuses a non-image extension with 403', async () => {
    expect((await serve('secrets.txt')).status).toBe(403)
  })

  it('returns the bytes with the image type and defensive headers', async () => {
    const response = await serve('photo.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
  })

  it('maps a refusal to 403', async () => {
    expect((await serve('secrets.txt')).status).toBe(403)
    expect((await serve('../elsewhere/outside.png')).status).toBe(403)
  })

  it('maps a missing file to 404, not 403', async () => {
    // The widget says "not found" for this; a 403 would imply the user did
    // something wrong.
    expect((await serve('nope.png')).status).toBe(404)
  })

  it('maps a directory named like an image to 404', async () => {
    await fsp.mkdir(path.join(notes, 'dir.png'))
    expect((await serve('dir.png')).status).toBe(404)
  })

  it('refuses an oversized file with 413 without reading it all', async () => {
    // Sparse: allocates no disk, but stat reports the size.
    const big = await fsp.open(path.join(notes, 'huge.png'), 'w')
    await big.truncate(MAX_IMAGE_BYTES + 1)
    await big.close()
    expect((await serve('huge.png')).status).toBe(413)
  })

  it('never answers a malformed percent sequence with 500', async () => {
    // `100%.png` is an ordinary authoring mistake, not a bug in the app.
    const response = await serve('100%.png')
    expect(response.status).toBe(404)
  })

  it('classifies errors the way the widget expects', () => {
    expect(statusForError(new PathPermissionError())).toBe(403)
    expect(statusForError(Object.assign(new Error(), { code: 'ENOENT' }))).toBe(404)
    expect(statusForError(Object.assign(new Error(), { code: 'EFBIG' }))).toBe(413)
    expect(statusForError(new TypeError('surprise'))).toBe(500)
  })
})
