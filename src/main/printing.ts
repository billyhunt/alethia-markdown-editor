import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { grantFile } from './paths.ts'

/**
 * Renders the window to PDF through the same print stylesheet the printer
 * would use.
 *
 * printBackground is on because this design's blacks are structural -- the
 * code slab and table head are filled shapes, and without it they come out
 * as white boxes.
 */
export async function exportPdf(
  win: BrowserWindow | null,
  suggestedName: unknown,
): Promise<string | null> {
  if (!win) return null
  const base = typeof suggestedName === 'string' && suggestedName.trim() ? suggestedName : 'Untitled'
  const stem = base.replace(/\.[^.]+$/, '')

  const result = await dialog.showSaveDialog(win, {
    defaultPath: `${stem}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (result.canceled || !result.filePath) return null

  const target = result.filePath.toLowerCase().endsWith('.pdf')
    ? result.filePath
    : `${result.filePath}.pdf`

  const data = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'Letter',
    // The stylesheet's @page rule supplies the margins.
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  })

  await fs.writeFile(target, data)
  // A PDF we just wrote is ours to reveal afterwards.
  grantFile(path.resolve(target))
  return target
}
