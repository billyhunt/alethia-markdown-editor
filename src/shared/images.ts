export const IMAGE_PROTOCOL = 'alethia-image'

/** Only relative filesystem targets may be served through the local-image protocol. */
export function isRelativeImageTarget(target: string): boolean {
  const value = target.trim()
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value)
  )
}

/**
 * Keeps renderer-supplied paths inside a query string; main resolves and
 * re-authorizes both paths before it reads an image.
 */
export function imageProtocolUrl(documentPath: string, target: string): string {
  const url = new URL(`${IMAGE_PROTOCOL}://asset/`)
  url.searchParams.set('document', documentPath)
  url.searchParams.set('target', target)
  return url.toString()
}
