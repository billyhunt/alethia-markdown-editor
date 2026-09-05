/**
 * The contract between the renderer and the Electron main process.
 *
 * This file is compiled into BOTH the renderer and the electron TypeScript
 * projects, so it must contain types and plain constants only -- never any
 * runtime import of `electron` or of DOM globals.
 *
 * Phase 1 exposes the minimum needed to prove the bridge works end to end.
 * Later phases grow `MarkdownApi` with dialog/fs/folder/settings surfaces.
 */

export interface RendererReadyResult {
  platform: string
  version: string
  isPackaged: boolean
}

export interface MarkdownApi {
  app: {
    /**
     * Called once by the renderer after its event listeners are registered.
     * Later phases use the return value to flush queued "open with" paths and
     * to hand over persisted settings.
     */
    rendererReady(): Promise<RendererReadyResult>
  }
}
