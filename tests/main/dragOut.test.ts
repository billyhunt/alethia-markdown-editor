import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const native = vi.hoisted(() => ({ getFileIcon: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getFileIcon: native.getFileIcon },
  nativeImage: { createFromDataURL: () => ({ fallback: true }) },
}))

import { grantRoot } from '../../src/main/paths.ts'
import { startPathDrag } from '../../src/main/dragOut.ts'

let granted: string
let outside: string
const contents = { startDrag: vi.fn(), isDestroyed: vi.fn(() => false) }

beforeAll(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-drag-')))
  granted = path.join(root, 'notes')
  outside = path.join(root, 'private')
  await fs.mkdir(granted)
  await fs.mkdir(outside)
  for (const name of ['a.md', 'b.md', 'c.txt', 'd.TXT', 'image.png']) await fs.writeFile(path.join(granted, name), '')
  await fs.writeFile(path.join(outside, 'secret.md'), '')
  grantRoot(granted)
})

afterAll(async () => {
  await fs.rm(path.dirname(granted), { recursive: true, force: true })
})

beforeEach(() => {
  contents.startDrag.mockReset()
  contents.isDestroyed.mockReturnValue(false)
  native.getFileIcon.mockReset()
  native.getFileIcon.mockResolvedValue({ isEmpty: () => true })
})

const drag = (target: unknown) => startPathDrag(contents as never, target)

describe('dragging a sidebar row out of the window', () => {
  it('starts a native drag of the file, with an icon', async () => {
    const file = path.join(granted, 'a.md')
    await expect(drag({ path: file })).resolves.toBe(file)
    expect(contents.startDrag).toHaveBeenCalledWith({ file, icon: expect.anything() })
  })

  it('drags a folder too, so a terminal can cd into it', async () => {
    await drag({ path: granted })
    expect(contents.startDrag).toHaveBeenCalledWith(expect.objectContaining({ file: granted }))
  })

  it('refuses a path the window was never given', async () => {
    await expect(drag({ path: path.join(outside, 'secret.md') })).rejects.toThrow('EPERM')
    await expect(drag({ path: outside })).rejects.toThrow('EPERM')
    expect(contents.startDrag).not.toHaveBeenCalled()
  })

  it('refuses anything that is not a readable document', async () => {
    await expect(drag({ path: path.join(granted, 'image.png') })).rejects.toThrow()
    await expect(drag({ path: 'relative.md' })).rejects.toThrow()
    await expect(drag(null)).rejects.toThrow()
    expect(contents.startDrag).not.toHaveBeenCalled()
  })

  it('decides itself whether a path is a folder, so kind cannot skip the type check', async () => {
    await expect(drag({ path: path.join(granted, 'image.png'), kind: 'dir' })).rejects.toThrow()
    expect(contents.startDrag).not.toHaveBeenCalled()
  })

  it("never waits on an icon lookup, and uses Finder's icon once it is known", async () => {
    let finish!: (icon: unknown) => void
    native.getFileIcon.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    await drag({ path: path.join(granted, 'c.txt') })
    expect(contents.startDrag).toHaveBeenLastCalledWith(expect.objectContaining({ icon: { fallback: true } }))

    const finder = { isEmpty: () => false }
    finish(finder)
    await new Promise((resolve) => setImmediate(resolve))
    await drag({ path: path.join(granted, 'd.TXT') })
    expect(contents.startDrag).toHaveBeenLastCalledWith(expect.objectContaining({ icon: finder }))
  })

  it('keeps the plain icon when Finder has none', async () => {
    native.getFileIcon.mockResolvedValue({ isEmpty: () => true })
    await drag({ path: path.join(granted, 'a.md') })
    await new Promise((resolve) => setImmediate(resolve))
    await drag({ path: path.join(granted, 'b.md') })
    expect(contents.startDrag).toHaveBeenLastCalledWith(expect.objectContaining({ icon: { fallback: true } }))
  })

  it('does nothing once the window has gone', async () => {
    contents.isDestroyed.mockReturnValue(true)
    await drag({ path: path.join(granted, 'a.md') })
    expect(contents.startDrag).not.toHaveBeenCalled()
  })
})
