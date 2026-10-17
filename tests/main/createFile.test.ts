import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// files.ts creates the default folder under the user's Documents, and
// paths.ts protects userData; neither exists in a test run.
const USER_DATA = path.join(os.tmpdir(), 'alethia-createfile-userdata')
let documents: string
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'documents' ? documents : USER_DATA) },
}))

const { createNamedFile } = await import('../../src/main/files.ts')
const { assertReadable, assertWritable, grantRoot } = await import('../../src/main/paths.ts')

let root: string
let outside: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-create-'))
  documents = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-documents-'))
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-elsewhere-'))
  outside = path.join(elsewhere, 'private.md')
  await fs.writeFile(outside, '# private')
  grantRoot(root)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(documents, { recursive: true, force: true })
  await fs.rm(path.dirname(outside), { recursive: true, force: true })
  await fs.rm(USER_DATA, { recursive: true, force: true })
})

describe('createNamedFile', () => {
  it('creates the file with its content in one step', async () => {
    const created = await createNamedFile({
      dir: root,
      name: 'Weekly review.md',
      content: '# Weekly review\n',
    })
    // The canonical path, which is what grants, recents and windows key on
    // (/private/var, not /var, for a temp folder on macOS).
    expect(created.path).toBe(path.join(await fs.realpath(root), 'Weekly review.md'))
    expect(created.mtimeMs).toBeGreaterThan(0)
    expect(await fs.readFile(created.path, 'utf8')).toBe('# Weekly review\n')
  })

  it('restores the line endings the document was using', async () => {
    const created = await createNamedFile({
      dir: root,
      name: 'Crlf.md',
      content: 'one\ntwo\n',
      lineEnding: '\r\n',
    })
    expect(await fs.readFile(created.path, 'utf8')).toBe('one\r\ntwo\r\n')
  })

  it('adds a markdown extension when the name has none', async () => {
    const created = await createNamedFile({ dir: root, name: 'Plain title' })
    expect(path.basename(created.path)).toBe('Plain title.md')
  })

  it('numbers the name rather than overwriting an existing file', async () => {
    await fs.writeFile(path.join(root, 'Taken.md'), '# keep me')
    const created = await createNamedFile({ dir: root, name: 'Taken.md', content: '# new' })
    expect(path.basename(created.path)).toBe('Taken 2.md')
    expect(await fs.readFile(path.join(root, 'Taken.md'), 'utf8')).toBe('# keep me')
  })

  it('removes the partial file when the write fails, and the retry reuses the name', async () => {
    const realOpen = fs.open.bind(fs)
    const open = vi.spyOn(fs, 'open').mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      const handle = await realOpen(...args)
      // Half the data lands, then the disk fills.
      handle.writeFile = async (data) => {
        await handle.write(String(data).slice(0, 4))
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      }
      return handle
    })

    await expect(
      createNamedFile({ dir: root, name: 'Disk full.md', content: '# Disk full\n' }),
    ).rejects.toThrow(/ENOSPC/)
    open.mockRestore()

    // Nothing truncated is left to be read back as the document.
    await expect(fs.access(path.join(root, 'Disk full.md'))).rejects.toThrow()
    // And a later attempt does not number itself around the wreckage.
    const retried = await createNamedFile({ dir: root, name: 'Disk full.md', content: '# Disk full\n' })
    expect(path.basename(retried.path)).toBe('Disk full.md')
    expect(await fs.readFile(retried.path, 'utf8')).toBe('# Disk full\n')
  })

  it('never removes a file it did not create when the exclusive create fails', async () => {
    await fs.writeFile(path.join(root, 'Theirs.md'), '# theirs')
    const created = await createNamedFile({ dir: root, name: 'Theirs.md', content: '# mine' })
    expect(path.basename(created.path)).toBe('Theirs 2.md')
    expect(await fs.readFile(path.join(root, 'Theirs.md'), 'utf8')).toBe('# theirs')
  })

  it('falls back to a folder of its own under Documents', async () => {
    const created = await createNamedFile({ name: 'Loose thought.md' })
    expect(created.path).toBe(
      path.join(await fs.realpath(documents), 'Alethia', 'Loose thought.md'),
    )
  })

  it.each([
    ['a path instead of a name', { name: '../escape.md' }],
    ['a nested name', { name: 'sub/note.md' }],
    ['an empty name', { name: '  ' }],
    ['a non-string name', { name: 7 }],
    ['non-string content', { dir: undefined, name: 'ok.md', content: 7 }],
  ])('refuses %s', async (_label, opts) => {
    await expect(createNamedFile(opts)).rejects.toThrow()
  })

  it('refuses a folder that was never granted', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-ungranted-'))
    await expect(createNamedFile({ dir: other, name: 'Note.md' })).rejects.toThrow(/EPERM/)
    await fs.rm(other, { recursive: true, force: true })
  })

  it('does not grant a symlink it collides with, nor write through it', async () => {
    const link = path.join(root, 'Linked.md')
    await fs.symlink(outside, link)

    const created = await createNamedFile({ dir: root, name: 'Linked.md', content: '# mine' })
    // The name was numbered around the link rather than written through it.
    expect(path.basename(created.path)).toBe('Linked 2.md')
    expect(await fs.readFile(outside, 'utf8')).toBe('# private')
    // And the collision handed out no access to whatever the link points at.
    await expect(assertReadable(outside)).rejects.toThrow(/EPERM/)
    await expect(assertWritable(outside)).rejects.toThrow(/EPERM/)
  })
})
