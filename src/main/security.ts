import { shell, session, type WebContents } from 'electron'

/**
 * Locks down a WebContents so that renderer-side content can never navigate
 * the window away from our own app or open arbitrary windows.
 *
 * `will-navigate` also covers the default Chromium behaviour of navigating to
 * `file://` when a file is dropped onto the window, which would otherwise
 * destroy the running app.
 */
export function hardenWebContents(wc: WebContents, allowedUrl: string): void {
  wc.on('will-navigate', (event, url) => {
    if (url !== allowedUrl) event.preventDefault()
  })

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  wc.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

/** Denies every renderer permission request; the app needs none of them. */
export function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}
