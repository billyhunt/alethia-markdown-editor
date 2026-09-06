import { app, Menu, shell, type MenuItemConstructorOptions, type BrowserWindow } from 'electron'
import { sendCommand, focusedWindow } from './commands.ts'
import { createWindow } from './windows.ts'
import { applyTheme } from './theme.ts'
import { getSettings, patchSettings } from './settings.ts'
import type { HostCommand } from '../shared/ipc.ts'
import type { ThemePreference } from '../shared/settings.ts'

const REPO_URL = 'https://github.com/'

/**
 * Menu items stay permanently enabled and the renderer no-ops when there is
 * no document. Enabling per state would mean rebuilding the whole menu on
 * every store change.
 */
const cmd = (
  label: string,
  command: HostCommand,
  accelerator?: string,
): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: (_item, win) => dispatch(win as BrowserWindow | undefined, command),
})

/**
 * On macOS the app can be running with no windows. File-opening commands
 * create one; anything else has nowhere meaningful to go.
 */
function dispatch(win: BrowserWindow | undefined, command: HostCommand): void {
  // Electron passes no window when the app is not frontmost, so fall back to
  // any open one rather than dropping the command on the floor.
  const target = win ?? focusedWindow()
  if (target) {
    sendCommand(target, command)
    return
  }
  if (command === 'file:new' || command === 'file:open' || command === 'file:openFolder') {
    const created = createWindow()
    created.webContents.once('did-finish-load', () => sendCommand(created, command))
  }
}

export function buildApplicationMenu(): void {
  const theme = getSettings().theme

  const themeItem = (label: string, value: ThemePreference): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: theme === value,
    click: () => {
      patchSettings({ theme: value })
      applyTheme(value)
      buildApplicationMenu() // rebuild so the radio check moves
    },
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        cmd('New', 'file:new', 'CmdOrCtrl+N'),
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            createWindow()
          },
        },
        cmd('Open…', 'file:open', 'CmdOrCtrl+O'),
        cmd('Open Folder…', 'file:openFolder', 'CmdOrCtrl+Shift+O'),
        // macOS populates this natively from app.addRecentDocument.
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        cmd('Close File', 'file:close', 'CmdOrCtrl+W'),
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
        { type: 'separator' },
        cmd('Save', 'file:save', 'CmdOrCtrl+S'),
        cmd('Save As…', 'file:saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('Reveal in Finder', 'file:revealInFinder'),
        { type: 'separator' },
        // macOS's own print panel carries "Save as PDF", so this is the
        // export path too and no separate PDF command is needed.
        cmd('Print…', 'file:print', 'CmdOrCtrl+P'),
        cmd('Export as PDF…', 'file:exportPdf', 'CmdOrCtrl+Shift+P'),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'edit:undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'edit:redo', 'Shift+CmdOrCtrl+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
      ],
    },
    {
      label: 'View',
      // Deliberately not role: 'viewMenu' -- its Reload item would discard
      // the open document.
      submenu: [
        cmd('Toggle Sidebar', 'view:toggleSidebar', 'CmdOrCtrl+\\'),
        cmd('Toggle Format Bar', 'view:toggleToolbar', 'CmdOrCtrl+Shift+T'),
        cmd('Autosave', 'view:toggleAutosave'),
        { type: 'separator' },
        cmd('Focus Mode', 'view:toggleFocusMode', 'F8'),
        cmd('Typewriter Mode', 'view:toggleTypewriterMode', 'F9'),
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: [
            themeItem('System', 'system'),
            themeItem('Light', 'light'),
            themeItem('Dark', 'dark'),
          ],
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Format',
      submenu: [
        cmd('Bold', 'format:bold', 'CmdOrCtrl+B'),
        cmd('Italic', 'format:italic', 'CmdOrCtrl+I'),
        cmd('Strikethrough', 'format:strikethrough', 'Ctrl+Shift+X'),
        cmd('Inline Code', 'format:inlineCode', 'CmdOrCtrl+E'),
        { type: 'separator' },
        cmd('Heading 1', 'format:heading1', 'CmdOrCtrl+1'),
        cmd('Heading 2', 'format:heading2', 'CmdOrCtrl+2'),
        cmd('Heading 3', 'format:heading3', 'CmdOrCtrl+3'),
        cmd('Heading 4', 'format:heading4', 'CmdOrCtrl+4'),
        cmd('Heading 5', 'format:heading5', 'CmdOrCtrl+5'),
        cmd('Heading 6', 'format:heading6', 'CmdOrCtrl+6'),
        cmd('Paragraph', 'format:paragraph', 'CmdOrCtrl+0'),
        { type: 'separator' },
        cmd('Quote', 'format:blockquote', 'CmdOrCtrl+Shift+Q'),
        cmd('Code Block', 'format:codeBlock', 'CmdOrCtrl+Shift+K'),
        cmd('Bullet List', 'format:bulletList', 'CmdOrCtrl+Shift+U'),
        cmd('Ordered List', 'format:orderedList', 'CmdOrCtrl+Shift+L'),
        cmd('Horizontal Rule', 'format:horizontalRule'),
        { type: 'separator' },
        cmd('Link', 'format:link', 'CmdOrCtrl+K'),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Alethia on GitHub',
          click: () => {
            void shell.openExternal(REPO_URL)
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
