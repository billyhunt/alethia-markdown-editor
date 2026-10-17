import { EventEmitter } from 'node:events'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const native = vi.hoisted(() => ({ getFileIcon: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getFileIcon: native.getFileIcon },
  nativeImage: { createFromDataURL: () => ({ fallback: true }) },
}))

import { grantRoot } from '../../src/main/paths.ts'
import { DRAG_OUT_MS, startPathDrag, takeOwnDrag } from '../../src/main/dragOut.ts'

let granted: string
let outside: string
// A window's webContents: an emitter, so focus and mouse events can be sent.
const contents = Object.assign(new EventEmitter(), { startDrag: vi.fn(), isDestroyed: vi.fn(() => false) })

beforeAll(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-drag-')))
  granted = path.join(root, 'notes')
  outside = path.join(root, 'private')
  await fs.mkdir(granted)
  await fs.mkdir(outside)
  for (const name of ['a.md', 'b.md', 'c.txt', 'd.TXT', 'image.png']) await fs.writeFile(path.join(granted, name), '')
  await fs.writeFile(path.join(outside, 'secret.md'), '')
  await fs.symlink(path.join(outside, 'secret.md'), path.join(granted, 'link.md'))
  await fs.symlink(outside, path.join(granted, 'linked-dir'))
  grantRoot(granted)
})

afterAll(async () => {
  await fs.rm(path.dirname(granted), { recursive: true, force: true })
})

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  contents.removeAllListeners()
  contents.startDrag.mockReset()
  contents.isDestroyed.mockReturnValue(false)
  native.getFileIcon.mockReset()
  native.getFileIcon.mockResolvedValue({ isEmpty: () => true })
})

const drag = (target: unknown) => startPathDrag(contents as never, target)

describe('dragging a sidebar row out of the window', () => {
  it('starts a native drag of the file, with an icon', async () => {
    const file = path.join(granted, 'a.md')
    await drag({ path: file })
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

  it('refuses a symlink inside a granted folder that points outside it', async () => {
    await expect(drag({ path: path.join(granted, 'link.md') })).rejects.toThrow('EPERM')
    await expect(drag({ path: path.join(granted, 'linked-dir') })).rejects.toThrow('EPERM')
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

describe('recognising the drag coming back to the window', () => {
  const file = () => path.join(granted, 'a.md')
  const other = () => path.join(granted, 'b.md')

  it('knows a drop of the path it just dragged, once', async () => {
    await drag({ path: file() })
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(true)
    // A later, real drop of the same item is the user's.
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
  })

  it('knows nothing when no drag was started, or for a window that never dragged', async () => {
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
    await drag({ path: file() })
    const stranger = new EventEmitter()
    await expect(takeOwnDrag(stranger as never, file())).resolves.toBe(false)
  })

  it('matches the item dropped through a symlink to the dragged path', async () => {
    const alias = path.join(path.dirname(granted), 'alias')
    await fs.symlink(granted, alias)
    await drag({ path: path.join(granted, 'a.md') })
    await expect(takeOwnDrag(contents as never, path.join(alias, 'a.md'))).resolves.toBe(true)
  })

  it('is spent by a drop of anything else, which is then not swallowed', async () => {
    await drag({ path: file() })
    await expect(takeOwnDrag(contents as never, other())).resolves.toBe(false)
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
  })

  it('only remembers the latest drag', async () => {
    await drag({ path: file() })
    await drag({ path: other() })
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
    await drag({ path: file() })
    await drag({ path: other() })
    await expect(takeOwnDrag(contents as never, other())).resolves.toBe(true)
  })

  it('does not swallow a Finder drop after a drag that ended in Terminal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await drag({ path: file() })
    // Dropped in Terminal: the window sees nothing more, and never regains focus.
    vi.advanceTimersByTime(DRAG_OUT_MS + 1)
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
  })

  it('still knows its own drop that took a while to land', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await drag({ path: file() })
    vi.advanceTimersByTime(DRAG_OUT_MS - 1000)
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(true)
  })

  it('is cleared when the window regains focus', async () => {
    await drag({ path: file() })
    contents.emit('focus')
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
  })

  it('is cleared by the next click, not by moving the mouse', async () => {
    await drag({ path: file() })
    contents.emit('before-mouse-event', {}, { type: 'mouseMove' })
    contents.emit('before-mouse-event', {}, { type: 'mouseUp' })
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(true)
    await drag({ path: file() })
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' })
    await expect(takeOwnDrag(contents as never, file())).resolves.toBe(false)
  })

  it('leaves no listeners behind', async () => {
    await drag({ path: file() })
    await drag({ path: other() })
    expect(contents.listenerCount('focus')).toBe(1)
    contents.emit('focus')
    expect(contents.listenerCount('focus')).toBe(0)
    expect(contents.listenerCount('before-mouse-event')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
  })

  it('does not remember a drag that was refused', async () => {
    await expect(drag({ path: path.join(outside, 'secret.md') })).rejects.toThrow()
    await expect(takeOwnDrag(contents as never, path.join(outside, 'secret.md'))).resolves.toBe(false)
  })
})
