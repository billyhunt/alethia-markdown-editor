import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { MARKDOWN_EXTENSIONS, READABLE_EXTENSIONS } from '../shared/markdown.ts'
import { grantFile, grantRoot } from './paths.ts'
import type { SaveAsOptions, SaveChangesChoice } from '../shared/api.ts'

const stripDot = (ext: string): string => ext.replace(/^\./, '')
const READABLE = READABLE_EXTENSIONS.map(stripDot)
const WRITABLE = MARKDOWN_EXTENSIONS.map(stripDot)

export async function showOpenFile(win: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: READABLE }],
  })
  const [chosen] = result.filePaths
  if (result.canceled || !chosen) return null
  // The dialog is a source main controls, so its result is trustworthy.
  return grantFile(chosen)
}

export async function showOpenFolder(win: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    properties: ['openDirectory', 'createDirectory'],
  })
  const [chosen] = result.filePaths
  if (result.canceled || !chosen) return null
  // Opening a folder grants its whole subtree.
  return grantRoot(chosen)
}

export async function showSaveAs(
  win: BrowserWindow | null,
  opts: SaveAsOptions = {},
): Promise<string | null> {
  const suggested = opts.suggestedName ?? 'Untitled.md'
  const result = await dialog.showSaveDialog(win ?? undefined!, {
    defaultPath: opts.defaultDir ? path.join(opts.defaultDir, suggested) : suggested,
    filters: [{ name: 'Markdown', extensions: WRITABLE }],
  })
  if (result.canceled || !result.filePath) return null
  // Force a markdown extension so assertWritable can never reject our own
  // dialog result.
  const chosen = MARKDOWN_EXTENSIONS.some((ext) => result.filePath.toLowerCase().endsWith(ext))
    ? result.filePath
    : `${result.filePath}.md`
  return grantFile(chosen)
}

export async function confirmSaveChanges(
  win: BrowserWindow | null,
  fileName: string,
): Promise<SaveChangesChoice> {
  const { response } = await dialog.showMessageBox(win ?? undefined!, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes you made to "${fileName}"?`,
    detail: "Your changes will be lost if you don't save them.",
  })
  if (response === 0) return 'save'
  if (response === 1) return 'dontSave'
  return 'cancel'
}

export async function showError(
  win: BrowserWindow | null,
  title: string,
  message: string,
): Promise<void> {
  await dialog.showMessageBox(win ?? undefined!, {
    type: 'error',
    buttons: ['OK'],
    message: title,
    detail: message,
  })
}
