import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

let template: MenuItemConstructorOptions[] = []
const openExternal = vi.fn()
const sendCommand = vi.fn()

vi.mock('electron', () => ({
  app: { name: 'Alethia', isPackaged: true },
  shell: { openExternal: (...args: unknown[]) => openExternal(...args) },
  Menu: {
    buildFromTemplate: (input: MenuItemConstructorOptions[]) => input,
    setApplicationMenu: (menu: MenuItemConstructorOptions[]) => {
      template = menu
    },
  },
}))

/** Stands in for the frontmost window, so dispatch has somewhere to send. */
const FOCUSED = { id: 1 }

vi.mock('../../src/main/commands.ts', () => ({
  sendCommand: (...args: unknown[]) => sendCommand(...args),
  focusedWindow: () => FOCUSED,
}))
vi.mock('../../src/main/windows.ts', () => ({ createWindow: vi.fn() }))
vi.mock('../../src/main/theme.ts', () => ({ applyTheme: vi.fn() }))
vi.mock('../../src/main/settings.ts', () => ({
  getSettings: () => ({ theme: 'system' }),
  patchSettings: vi.fn(),
}))

const { buildApplicationMenu } = await import('../../src/main/menu.ts')

/** Walks the template by label, so a test names the path a user would take. */
function item(...labels: string[]): MenuItemConstructorOptions {
  let level = template
  let found: MenuItemConstructorOptions | undefined
  for (const label of labels) {
    found = level.find((entry) => entry.label === label || entry.role === label.toLowerCase())
    if (!found) throw new Error(`no menu item ${labels.join(' > ')} (missing ${label})`)
    level = (found.submenu ?? []) as MenuItemConstructorOptions[]
  }
  return found as MenuItemConstructorOptions
}

/** Clicks an item the way Electron does, with no window in front. */
function click(entry: MenuItemConstructorOptions): void {
  entry.click?.(
    undefined as never,
    undefined as never,
    undefined as never,
  )
}

beforeEach(() => {
  openExternal.mockClear()
  sendCommand.mockClear()
  buildApplicationMenu()
})

describe('close accelerators', () => {
  it('gives Cmd+W to the window, as every other Mac app does', () => {
    expect(item('File', 'Close Window').accelerator).toBe('CmdOrCtrl+W')
    expect(item('File', 'Close Window').role).toBe('close')
  })

  it('moves closing just the document onto the modified key', () => {
    expect(item('File', 'Close File').accelerator).toBe('CmdOrCtrl+Shift+W')
  })
})

describe('Find submenu', () => {
  it('exposes the search commands the keymap already supported', () => {
    const labels = (item('Edit', 'Find').submenu as MenuItemConstructorOptions[])
      .filter((entry) => entry.type !== 'separator')
      .map((entry) => [entry.label, entry.accelerator])

    expect(labels).toEqual([
      ['Find…', 'CmdOrCtrl+F'],
      ['Find and Replace…', 'Alt+CmdOrCtrl+F'],
      ['Find Next', 'CmdOrCtrl+G'],
      ['Find Previous', 'Shift+CmdOrCtrl+G'],
      ['Use Selection for Find', 'Shift+CmdOrCtrl+E'],
    ])
  })

  it('dispatches each one as its host command', () => {
    // A menu item wired to the wrong command still looks right in the test
    // above, so click each one and watch what reaches the renderer.
    for (const [label, command] of [
      ['Find…', 'edit:find'],
      ['Find and Replace…', 'edit:findReplace'],
      ['Find Next', 'edit:findNext'],
      ['Find Previous', 'edit:findPrevious'],
      ['Use Selection for Find', 'edit:useSelectionForFind'],
    ]) {
      sendCommand.mockClear()
      click(item('Edit', 'Find', label))
      expect(sendCommand, label).toHaveBeenCalledWith(FOCUSED, command)
    }
  })

  it('does not collide with Inline Code on Cmd+E', () => {
    expect(item('Format', 'Inline Code').accelerator).toBe('CmdOrCtrl+E')
    expect(item('Edit', 'Find', 'Use Selection for Find').accelerator).not.toBe('CmdOrCtrl+E')
  })
})

describe('Help', () => {
  it('opens the Alethia repository, not GitHub itself', () => {
    click(item('Help', 'Alethia on GitHub'))
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/billyhunt/alethia-markdown-editor',
    )
  })
})
