import { BrowserWindow, Menu, clipboard, shell } from 'electron'
import { isMarkdownPath } from '../shared/markdown.ts'
import { assertReadableDir, assertWritable, validatePath } from './paths.ts'
import type { FileContextResult, PathKind } from '../shared/api.ts'

/**
 * The sidebar's right-click menu, built natively so it matches the platform
 * (and so destructive items get real macOS menu semantics).
 *
 * Deleting moves the file to the Trash rather than unlinking it: the user can
 * always get it back, and an editor should never make an unrecoverable change
 * on a single click.
 */
export async function showFileContextMenu(
  win: BrowserWindow | null,
  target: unknown,
): Promise<FileContextResult> {
  const input = (typeof target === 'object' && target !== null ? target : {}) as {
    path?: unknown
    kind?: unknown
  }
  const kind: PathKind = input.kind === 'dir' ? 'dir' : 'file'
  const filePath = validatePath(input.path)

  // Confirm the path is one main handed out before offering to act on it.
  if (kind === 'dir') await assertReadableDir(filePath)
  else await assertWritable(filePath)

  return new Promise<FileContextResult>((resolve) => {
    let outcome: FileContextResult = { action: 'cancelled' }

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Reveal in Finder',
        click: () => {
          shell.showItemInFolder(filePath)
          outcome = { action: 'revealed' }
        },
      },
      {
        label: 'Copy Path',
        click: () => {
          clipboard.writeText(filePath)
          outcome = { action: 'copiedPath' }
        },
      },
    ]

    // Folders are deliberately not trashable here -- one stray click should not
    // put a whole workspace in the Trash.
    if (kind === 'file' && isMarkdownPath(filePath)) {
      template.push(
        { type: 'separator' },
        {
          label: 'Version History…',
          // The history panel lives in the renderer, so main only reports
          // which file was asked about.
          click: () => {
            outcome = { action: 'history', path: filePath }
          },
        },
        { type: 'separator' },
        {
          label: 'Rename…',
          // Renaming needs a text field, so the sidebar takes over from here.
          click: () => {
            outcome = { action: 'rename', path: filePath }
          },
        },
        {
          label: 'Move to Trash',
          click: async () => {
            try {
              await shell.trashItem(filePath)
              outcome = { action: 'trashed', path: filePath }
            } catch {
              outcome = { action: 'cancelled' }
            }
          },
        },
      )
    }

    const menu = Menu.buildFromTemplate(template)
    menu.popup({
      window: win ?? undefined,
      // A click handler may still be running when the menu closes; give it a
      // tick so `outcome` is settled before resolving.
      callback: () => setTimeout(() => resolve(outcome), 60),
    })
  })
}
