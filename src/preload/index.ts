import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc.ts'
import type { MarkdownApi } from '../shared/api.ts'

/**
 * The only file on the renderer side allowed to touch ipcRenderer.
 *
 * It holds no state and contains no logic beyond shaping calls into the
 * MarkdownApi contract -- everything else lives in main or the renderer.
 */
const api: MarkdownApi = {
  app: {
    rendererReady: () => ipcRenderer.invoke(IPC.appRendererReady),
  },
}

contextBridge.exposeInMainWorld('api', api)
