import type { MarkdownApi } from '../shared/api'

/** The bridge exposed by the preload. */
export const api: MarkdownApi = window.api

/**
 * ipcMain.handle rejections reach the renderer wrapped in a long
 * "Error invoking remote method 'x:y':" prefix. Strip it for display.
 */
export function unwrapIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*':\s*/, '')
}
