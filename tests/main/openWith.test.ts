import { beforeEach, describe, expect, it, vi } from 'vitest'

const windows = vi.hoisted(() => ({
  createWindow: vi.fn(), windowShowing: vi.fn(() => null),
  vacantWindow: vi.fn(() => null), isReady: vi.fn(() => true),
  noteDocument: vi.fn(), noteFolder: vi.fn(),
}))
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('../../src/main/windows.ts', () => windows)
import { enqueuePath, route, takePendingPaths } from '../../src/main/openWith.ts'
import { IPC } from '../../src/shared/ipc.ts'

describe('early open-with paths', () => {
  beforeEach(() => { windows.createWindow.mockClear(); windows.vacantWindow.mockReset().mockReturnValue(null) })
  it('keeps two early documents in separate windows', async () => {
    const first = `/tmp/alethia-early-${Date.now()}-a.md`
    const second = first.replace('-a.md', '-b.md')
    const alias = first.replace('-a.md', '-alias.md')
    const fs = await import('node:fs/promises')
    await fs.writeFile(first, '# A')
    await fs.writeFile(second, '# B')
    await fs.symlink(first, alias)
    const canonicalFirst = await fs.realpath(first)
    const canonicalSecond = await fs.realpath(second)
    try {
      await enqueuePath(first)
      await enqueuePath(alias)
      await enqueuePath(second)
      const readyWindow = {} as Electron.BrowserWindow
      const assignedToReadyWindow = takePendingPaths(true, readyWindow)
      expect(assignedToReadyWindow).toEqual([{ path: canonicalFirst, kind: 'file' }])
      expect(windows.noteDocument).toHaveBeenCalledWith(readyWindow, canonicalFirst)
      expect(windows.createWindow).toHaveBeenCalledWith(expect.objectContaining({ file: canonicalSecond }))
      expect(windows.createWindow).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(first, { force: true })
      await fs.rm(second, { force: true })
      await fs.rm(alias, { force: true })
    }
  })

  it('routes a later path into a ready vacant window', () => {
    const send = vi.fn(), focus = vi.fn()
    const vacant = { webContents: { send }, focus }
    windows.vacantWindow.mockReturnValue(vacant as never)
    route({ path: '/tmp/later.md', kind: 'file' })
    expect(send).toHaveBeenCalledWith(IPC.hostOpenPath, { path: '/tmp/later.md', kind: 'file' })
    expect(focus).toHaveBeenCalledOnce()
    expect(windows.createWindow).not.toHaveBeenCalled()
  })
})
