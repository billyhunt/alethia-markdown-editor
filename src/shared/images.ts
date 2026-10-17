/**
 * The custom scheme main serves document images through. Shared so the
 * renderer builds exactly the URL main parses; see `main/images.ts` for the
 * rules main applies before serving anything.
 */
export const IMAGE_SCHEME = 'alethia-image'

/** True for a source the scheme will never serve: remote, data, or another scheme. */
export const isRemoteSource = (src: string): boolean => /^\s*[a-z][a-z0-9+.-]*:/i.test(src)

/** The URL the renderer puts in an `<img src>` for a local image. */
export function imageRequestUrl(docPath: string, src: string): string {
  const params = new URLSearchParams({ doc: docPath, src })
  return `${IMAGE_SCHEME}://local/?${params.toString()}`
}
