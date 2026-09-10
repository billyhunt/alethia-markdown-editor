import path from 'node:path'
import { BrowserWindow, Menu } from 'electron'
import { clearRecentFolders, listRecentFolders } from './recents.ts'
import type { FolderSwitcherResult } from '../shared/api.ts'

/**
 * The workspace switcher: the list of folders opened before, the way a vault
 * switcher works, so moving between a notes vault and a repository is a click
 * rather than a directory dialog every time.
 *
 * Native rather than an HTML popover, so it dismisses, scrolls and keys the
 * way every other menu on the platform does. Main owns the recents list, so
 * the renderer only has to say where the menu goes and act on the answer.
 */
export async function showFolderSwitcherMenu(
  win: BrowserWindow | null,
  current: string | null,
): Promise<FolderSwitcherResult> {
  const recents = await listRecentFolders()

  return new Promise<FolderSwitcherResult>((resolve) => {
    let outcome: FolderSwitcherResult = { action: 'cancelled' }

    const template: Electron.MenuItemConstructorOptions[] = recents.map((dir) => ({
      label: path.basename(dir) || dir,
      // The parent directory disambiguates two folders with the same name,
      // which is the usual case for `notes` or `docs`.
      sublabel: path.dirname(dir),
      toolTip: dir,
      type: 'checkbox',
      checked: dir === current,
      click: () => {
        // Re-opening the folder that is already open would only cost a
        // rescan; treat it as a dismissal.
        outcome = dir === current ? { action: 'cancelled' } : { action: 'switch', path: dir }
      },
    }))

    if (template.length > 0) template.push({ type: 'separator' })
    template.push({
      label: 'Open Folder…',
      click: () => {
        outcome = { action: 'open' }
      },
    })
    if (recents.length > 0) {
      template.push({
        label: 'Clear Recent Folders',
        click: () => {
          clearRecentFolders()
          outcome = { action: 'cleared' }
        },
      })
    }

    Menu.buildFromTemplate(template).popup({
      window: win ?? undefined,
      callback: () => resolve(outcome),
    })
  })
}
