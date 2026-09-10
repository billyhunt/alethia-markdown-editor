import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-rename-userdata')
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { readTextFile, renameFile, writeTextFile } = await import('../../src/main/files.ts')
const { listVersions } = await import('../../src/main/versions.ts')
const { assertReadable, grantRoot } = await import('../../src/main/paths.ts')

let root: string
let outside: string
const at = (name: string) => path.join(root, name)

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-rename-'))
  grantRoot(root)
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-rename-outside-'))
  outside = path.join(elsewhere, 'private.md')
  await fs.writeFile(outside, '# private')
  await fs.mkdir(USER_DATA, { recursive: true })
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(path.dirname(outside), { recursive: true, force: true })
  await fs.rm(USER_DATA, { recursive: true, force: true })
})

beforeEach(async () => {
  for (const entry of await fs.readdir(root)) {
    await fs.rm(path.join(root, entry), { recursive: true, force: true })
  }
})

describe('renameFile', () => {
  it('moves the file and keeps its content', async () => {
    await fs.writeFile(at('from.md'), '# body')
    const to = await renameFile(at('from.md'), 'to')
    expect(to).toBe(at('to.md'))
    expect(await fs.readFile(to, 'utf8')).toBe('# body')
    await expect(fs.access(at('from.md'))).rejects.toThrow()
  })

  it('refuses to replace an existing file', async () => {
    await fs.writeFile(at('a.md'), '# a')
    await fs.writeFile(at('b.md'), '# b')
    await expect(renameFile(at('a.md'), 'b.md')).rejects.toThrow(/EEXIST/)
    expect(await fs.readFile(at('b.md'), 'utf8')).toBe('# b')
    expect(await fs.readFile(at('a.md'), 'utf8')).toBe('# a')
  })

  it('refuses a destination symlink without granting what it points at', async () => {
    await fs.writeFile(at('source.md'), '# source')
    await fs.symlink(outside, at('link.md'))

    await expect(renameFile(at('source.md'), 'link.md')).rejects.toThrow(/EEXIST/)
    expect(await fs.readFile(outside, 'utf8')).toBe('# private')
    await expect(assertReadable(outside)).rejects.toThrow(/EPERM/)
  })

  it('carries the version history across, so earlier versions stay reachable', async () => {
    await fs.writeFile(at('history.md'), '# first')
    await writeTextFile(at('history.md'), '# second')
    await writeTextFile(at('history.md'), '# third')
    expect(await listVersions(at('history.md'))).toHaveLength(2)

    const to = await renameFile(at('history.md'), 'renamed')
    expect(await listVersions(to)).toHaveLength(2)
  })

  it('leaves an existing history at the destination alone', async () => {
    await fs.writeFile(at('one.md'), '# one')
    await writeTextFile(at('one.md'), '# one changed')

    await fs.writeFile(at('two.md'), '# two')
    await writeTextFile(at('two.md'), '# two changed')
    await fs.rm(at('one.md'))

    // A name that has been used before keeps the history it already had.
    const to = await renameFile(at('two.md'), 'one.md')
    const versions = await listVersions(to)
    expect(versions).toHaveLength(1)
  })

  it('does not report a false conflict after a rename following a touch', async () => {
    await fs.writeFile(at('touched.md'), '# body\n')
    const read = await readTextFile(at('touched.md'))

    // An external touch: same content, later mtime. The watcher stays quiet,
    // so the renderer still holds the mtime it read.
    const later = new Date(Date.now() + 5000)
    await fs.utimes(at('touched.md'), later, later)

    const to = await renameFile(at('touched.md'), 'touched again')
    const result = await writeTextFile(to, '# body changed\n', {
      expectedMtimeMs: read.mtimeMs,
    })
    expect(result.ok).toBe(true)
  })
})
