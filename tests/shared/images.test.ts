import { describe, expect, it } from 'vitest'
import { IMAGE_PROTOCOL, imageProtocolUrl, isRelativeImageTarget } from '../../src/shared/images.ts'

describe('relative image targets', () => {
  it.each(['diagram.png', 'assets/diagram.png', '../shared/chart.webp'])('accepts %s', (target) => {
    expect(isRelativeImageTarget(target)).toBe(true)
  })

  it.each(['/etc/passwd', '\\server\\share\\image.png', 'file:///tmp/image.png', 'https://example.com/a.png'])(
    'rejects %s',
    (target) => {
      expect(isRelativeImageTarget(target)).toBe(false)
    },
  )

  it('keeps both source paths as protocol query values', () => {
    const url = new URL(imageProtocolUrl('/notes/today.md', 'assets/diagram.png'))
    expect(url.protocol).toBe(`${IMAGE_PROTOCOL}:`)
    expect(url.hostname).toBe('asset')
    expect(url.searchParams.get('document')).toBe('/notes/today.md')
    expect(url.searchParams.get('target')).toBe('assets/diagram.png')
  })
})
