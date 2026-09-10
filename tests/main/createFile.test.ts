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
    expect(created.path).toBe(path.join(root, 'Weekly review.md'))
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

  it('falls back to a folder of its own under Documents', async () => {
    const created = await createNamedFile({ name: 'Loose thought.md' })
    expect(created.path).toBe(path.join(documents, 'Alethia', 'Loose thought.md'))
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
