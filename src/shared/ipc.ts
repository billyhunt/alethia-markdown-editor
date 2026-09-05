/**
 * Channel names shared by main and preload.
 *
 * `erasableSyntaxOnly` is enabled (TypeScript 6), so this is an `as const`
 * object rather than an enum.
 */
export const IPC = {
  appRendererReady: 'app:rendererReady',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
