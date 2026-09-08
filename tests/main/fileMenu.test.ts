import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions, PopupOptions } from 'electron'

const native = vi.hoisted(() => ({
  trashItem: vi.fn(), popup: vi.fn(), buildFromTemplate: vi.fn(),
}))
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: native.buildFromTemplate },
  shell: { trashItem: native.trashItem },
  clipboard: {},
}))
vi.mock('../../src/main/paths.ts', () => ({
  validatePath: (path: string) => path,
  assertWritable: vi.fn(), assertReadableDir: vi.fn(),
}))
import { showFileContextMenu } from '../../src/main/fileMenu.ts'

beforeEach(() => {
  vi.resetAllMocks()
  native.buildFromTemplate.mockReturnValue({ popup: native.popup })
})

async function selectTrash() {
  const result = showFileContextMenu(null, { path: '/test/delete.md', kind: 'file' })
  await vi.waitFor(() => expect(native.popup).toHaveBeenCalled())
  const template = native.buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[]
  const item = template.find(item => item.label === 'Move to Trash')!
  item.click!({} as never, undefined, {} as never)
  const options = native.popup.mock.calls[0][0] as PopupOptions
  options.callback!()
  return { result }
}

describe('Trash menu completion', () => {
  it('waits for trashing to finish after the menu closes', async () => {
    let finish!: () => void
    native.trashItem.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const { result } = await selectTrash()
    const completed = vi.fn()
    void result.then(completed)
    // The old 60 ms timeout reported cancellation while the file was still moving.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(completed).not.toHaveBeenCalled()
    finish()
    await expect(result).resolves.toEqual({ action: 'trashed', path: '/test/delete.md' })
  })

  it('does not report deletion if the filesystem operation fails', async () => {
    let fail!: (error: Error) => void
    native.trashItem.mockReturnValue(new Promise<void>((_, reject) => { fail = reject }))
    const { result } = await selectTrash()
    fail(new Error('Trash unavailable'))
    await expect(result).resolves.toEqual({ action: 'cancelled' })
  })
})
