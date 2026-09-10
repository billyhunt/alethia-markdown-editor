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
const { grantRoot } = await import('../../src/main/paths.ts')

let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-create-'))
  documents = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-documents-'))
  grantRoot(root)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(documents, { recursive: true, force: true })
  await fs.rm(USER_DATA, { recursive: true, force: true })
})

describe('createNamedFile', () => {
  it('creates an empty markdown file in a granted folder', async () => {
    const created = await createNamedFile({ dir: root, name: 'Weekly review.md' })
    expect(created).toBe(path.join(root, 'Weekly review.md'))
    expect(await fs.readFile(created, 'utf8')).toBe('')
  })

  it('adds a markdown extension when the name has none', async () => {
    const created = await createNamedFile({ dir: root, name: 'Plain title' })
    expect(path.basename(created)).toBe('Plain title.md')
  })

  it('numbers the name rather than overwriting an existing file', async () => {
    await fs.writeFile(path.join(root, 'Taken.md'), '# keep me')
    const created = await createNamedFile({ dir: root, name: 'Taken.md' })
    expect(path.basename(created)).toBe('Taken 2.md')
    expect(await fs.readFile(path.join(root, 'Taken.md'), 'utf8')).toBe('# keep me')
  })

  it('falls back to a folder of its own under Documents', async () => {
    const created = await createNamedFile({ name: 'Loose thought.md' })
    expect(created).toBe(path.join(documents, 'Alethia', 'Loose thought.md'))
  })

  it.each([
    ['a path instead of a name', { dir: undefined, name: '../escape.md' }],
    ['a nested name', { dir: undefined, name: 'sub/note.md' }],
    ['an empty name', { dir: undefined, name: '  ' }],
    ['a non-string name', { dir: undefined, name: 7 }],
  ])('refuses %s', async (_label, opts) => {
    await expect(createNamedFile(opts)).rejects.toThrow()
  })

  it('refuses a folder that was never granted', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-ungranted-'))
    await expect(createNamedFile({ dir: other, name: 'Note.md' })).rejects.toThrow(/EPERM/)
    await fs.rm(other, { recursive: true, force: true })
  })
})
