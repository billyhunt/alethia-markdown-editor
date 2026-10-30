// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isBroadRoot, listImplicitFolder, listMarkdownTree } from '../../src/main/folder.ts'
import { grantFile, grantRoot } from '../../src/main/paths.ts'

// paths.ts reaches for app.getPath('userData') to protect the settings
// directory; there is no Electron app object in a test run, and importing the
// real package would try to download the Electron binary when it is missing.
const USER_DATA = path.join(os.tmpdir(), 'alethia-test-userdata')
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

/**
 * Real directories, real realpath: the implicit listing decides what a file
 * opened from Finder may pull into the sidebar. Grants are module state, so
 * this file grants only what each case names.
 */

let base: string
let home: string
const realHome = process.env.HOME

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-implicit-')))
  home = path.join(base, 'home')
  await fs.mkdir(path.join(home, 'Documents'), { recursive: true })
  await fs.writeFile(path.join(home, 'Documents', 'note.md'), '# note\n')
  await fs.writeFile(path.join(home, 'todo.md'), '# todo\n')
  process.env.HOME = home
})

afterAll(async () => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  await fs.rm(base, { recursive: true, force: true })
})

describe('listImplicitFolder', () => {
  it('lists a granted ordinary folder', async () => {
    const docs = path.join(home, 'Documents')
    grantRoot(docs)

    const folder = await listImplicitFolder(docs)

    expect(folder?.root).toBe(docs)
    expect(folder?.tree?.children?.map((node) => node.name)).toEqual(['note.md'])
  })

  it('resolves null, not an error, for a folder main never granted', async () => {
    const stranger = path.join(base, 'stranger')
    await fs.mkdir(stranger)
    await fs.writeFile(path.join(stranger, 'x.md'), 'x')

    await expect(listImplicitFolder(stranger)).resolves.toBeNull()
  })

  it('resolves null when only the file was granted, as for a confirmed outside link', async () => {
    const outside = path.join(base, 'outside')
    await fs.mkdir(outside)
    const file = path.join(outside, 'linked.md')
    await fs.writeFile(file, 'x')
    grantFile(file)

    await expect(listImplicitFolder(outside)).resolves.toBeNull()
  })

  it('resolves null for the real parent of a symlinked file whose own folder was granted', async () => {
    const elsewhere = path.join(base, 'elsewhere')
    const selected = path.join(base, 'selected')
    await fs.mkdir(elsewhere)
    await fs.mkdir(selected)
    await fs.writeFile(path.join(elsewhere, 'real.md'), 'x')
    await fs.symlink(path.join(elsewhere, 'real.md'), path.join(selected, 'link.md'))
    grantRoot(selected)

    // The renderer is handed the canonical path, so it asks for this folder.
    await expect(listImplicitFolder(elsewhere)).resolves.toBeNull()
    // The folder that was granted is still fine.
    await expect(listImplicitFolder(selected)).resolves.toMatchObject({ root: selected })
  })

  it('resolves null for the home folder, also reached through a symlink, but not for an explicit open', async () => {
    const alias = path.join(base, 'home-alias')
    await fs.symlink(home, alias)
    grantRoot(home)
    grantRoot(alias)

    await expect(listImplicitFolder(home)).resolves.toBeNull()
    await expect(listImplicitFolder(alias)).resolves.toBeNull()
    // Opening the home folder on purpose is unchanged.
    await expect(listMarkdownTree(home)).resolves.toMatchObject({ root: home })
  })

  it('resolves null for a filesystem root', async () => {
    grantRoot('/')

    await expect(listImplicitFolder('/')).resolves.toBeNull()
  })

  it('still rejects a malformed path rather than treating it as declined', async () => {
    await expect(listImplicitFolder('relative/path')).rejects.toThrow(/EINVAL/)
    await expect(listImplicitFolder(42)).rejects.toThrow(/EINVAL/)
  })

  it('rejects, not null, for a granted folder that has vanished', async () => {
    const gone = path.join(base, 'gone')
    await fs.mkdir(gone)
    grantRoot(gone)
    await fs.rmdir(gone)

    await expect(listImplicitFolder(gone)).rejects.toThrow(/ENOENT/)
  })
})

describe('isBroadRoot', () => {
  it('treats the top level of a mounted volume as broad, and its contents as ordinary', async () => {
    await expect(isBroadRoot('/Volumes/Backup')).resolves.toBe(true)
    await expect(isBroadRoot('/Volumes/Backup/notes')).resolves.toBe(false)
  })

  it('treats the home folder and a root as broad, and a folder inside home as ordinary', async () => {
    await expect(isBroadRoot(await fs.realpath(home))).resolves.toBe(true)
    await expect(isBroadRoot('/')).resolves.toBe(true)
    await expect(isBroadRoot(path.join(home, 'Documents'))).resolves.toBe(false)
  })
})
