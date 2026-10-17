import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-rename-userdata')
const recentDocuments = vi.hoisted(() => [] as string[])
vi.mock('electron', () => ({
  app: {
    getPath: () => USER_DATA,
    addRecentDocument: (p: string) => recentDocuments.push(p),
    clearRecentDocuments: () => {
      recentDocuments.length = 0
    },
  },
  Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
  nativeTheme: {},
  screen: {},
}))

const { createNamedFile, readTextFile, renameFile, writeTextFile } = await import('../../src/main/files.ts')
const { renameRecent } = await import('../../src/main/recents.ts')
const { patchSettings, getSettings } = await import('../../src/main/settings.ts')
const { listVersions } = await import('../../src/main/versions.ts')
const { assertReadable, grantFile, grantRoot } = await import('../../src/main/paths.ts')

let root: string
let outside: string
const at = (name: string) => path.join(root, name)

beforeAll(async () => {
  // Canonical, as main reports paths: the macOS temp dir is a symlink.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-rename-')))
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
    const { path: to } = await renameFile(at('from.md'), 'to')
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

    const { path: to } = await renameFile(at('history.md'), 'renamed')
    expect(await listVersions(to)).toHaveLength(2)
  })

  it('keeps both histories when the destination name had history of its own', async () => {
    await fs.writeFile(at('one.md'), '# one')
    await writeTextFile(at('one.md'), '# one changed')

    await fs.writeFile(at('two.md'), '# two')
    await writeTextFile(at('two.md'), '# two changed')
    await fs.rm(at('one.md'))

    // A name that has been used before keeps the history it already had, and
    // the document's own history follows it in rather than being dropped.
    const { path: to } = await renameFile(at('two.md'), 'one.md')
    expect(await listVersions(to)).toHaveLength(2)
  })

  it('lets recents follow the file rather than accumulating its old names', async () => {
    // Automatic naming renames as a title grows, so the intermediate names
    // would otherwise pile up in File > Open Recent pointing at nothing.
    patchSettings({ recentFiles: [at('No.md'), at('Other.md')] })
    recentDocuments.length = 0

    renameRecent(at('No.md'), at('Notes.md'))
    expect(getSettings().recentFiles).toEqual([at('Notes.md'), at('Other.md')])
    expect(recentDocuments).toEqual([at('Other.md'), at('Notes.md')])
  })

  it('does not report a false conflict after a rename following a touch', async () => {
    await fs.writeFile(at('touched.md'), '# body\n')
    const read = await readTextFile(at('touched.md'))

    // An external touch: same content, later mtime. The watcher stays quiet,
    // so the renderer still holds the mtime it read.
    const later = new Date(Date.now() + 5000)
    await fs.utimes(at('touched.md'), later, later)

    const { path: to } = await renameFile(at('touched.md'), 'touched again')
    const result = await writeTextFile(to, '# body changed\n', {
      expectedMtimeMs: read.mtimeMs,
    })
    expect(result.ok).toBe(true)
  })
})

describe('renameFile and the automatic names built on it', () => {
  it('grants the destination only once the move has happened', async () => {
    // Only this one file is granted, not its folder, so a sibling is
    // readable exactly when something granted it.
    const lonely = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'alethia-lonely-'))
    try {
      const from = path.join(lonely, 'draft.md')
      const to = path.join(lonely, 'final.md')
      await fs.writeFile(from, '# draft')
      grantFile(from)

      const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      )
      await expect(renameFile(from, 'final')).rejects.toThrow(/EACCES/)
      link.mockRestore()
      // The move failed, so nothing was handed out for the name it never took.
      await expect(assertReadable(to)).rejects.toThrow(/EPERM/)
      expect(await fs.readFile(from, 'utf8')).toBe('# draft')

      await renameFile(from, 'final')
      await expect(assertReadable(to)).resolves.toBe(to)
    } finally {
      await fs.rm(lonely, { recursive: true, force: true })
    }
  })

  it.each([
    ['the rename first', 'rename-first'],
    ['the save first', 'save-first'],
  ])('never leaves two names when a save overlaps an automatic rename (%s)', async (_label, order) => {
    const created = await createNamedFile({ dir: root, name: 'Draft.md', content: '# Draft\n' })
    const started: Record<string, Promise<unknown>> = {}
    const steps: Array<[string, () => Promise<unknown>]> = [
      ['rename', () => renameFile(created.path, 'Final title.md')],
      ['save', () => writeTextFile(created.path, '# Final title\n\nmore words\n')],
    ]
    // Started in the order under test; both are in flight together.
    for (const [name, run] of order === 'rename-first' ? steps : [...steps].reverse()) {
      started[name] = run()
    }
    const [renamed, saved] = await Promise.allSettled([started.rename, started.save])
    expect(renamed.status).toBe('fulfilled')

    // One file, under the new name, whichever got there first.
    expect(await fs.readdir(root)).toEqual(['Final title.md'])
    const text = await fs.readFile(at('Final title.md'), 'utf8')
    if (saved.status === 'fulfilled') expect(text).toBe('# Final title\n\nmore words\n')
    // A save refused as stale is not lost, only redirected: the renderer
    // writes it again at the new name, which is checked below.
    else expect(String(saved.reason)).toMatch(/ESTALE/)

    const again = await writeTextFile(at('Final title.md'), '# Final title\n\nmore words\n')
    expect(again.ok).toBe(true)
    expect(await fs.readdir(root)).toEqual(['Final title.md'])
  })
})
