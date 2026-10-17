import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown } from '../../src/renderer/editor/inlineToDom.ts'

const text = (source: string): string => renderInlineMarkdown(source).textContent ?? ''

describe('renderInlineMarkdown (table cells)', () => {
  it('keeps emphasis as elements', () => {
    const out = renderInlineMarkdown('a **b** c')
    expect(out.querySelector('strong')?.textContent).toBe('b')
    expect(out.textContent).toBe('a b c')
  })

  it('shows a link as its text, not its destination', () => {
    expect(text('see [the docs](https://example.com) here')).toBe('see the docs here')
    // With a title, the space between destination and title survives as a
    // stray space. Pre-existing and cosmetic; recorded here so it is not
    // mistaken for a regression later.
    expect(text('see [the docs](https://example.com "Docs") here')).toBe('see the docs  here')
  })

  it('shows an image as its alt text, not alt run into the path', () => {
    // Before URL joined the skipped nodes this produced
    // "see A diagramassets/diagram.png here".
    expect(text('see ![A diagram](assets/diagram.png) here')).toBe('see A diagram here')
  })

  it('shows an image with no alt as nothing rather than as its path', () => {
    expect(text('a ![](x.png) b')).toBe('a  b')
  })
})
