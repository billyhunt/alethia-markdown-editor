import { describe, expect, it, vi } from 'vitest'
import { openLinkedMarkdown, resolveLinkedMarkdown } from '../../src/main/links.ts'

describe('resolveLinkedMarkdown', () => {
  it.each([
    ['./notes.md', '/docs/start.md', '/docs/notes.md'],
    ['../notes.md', '/docs/sub/start.md', '/docs/notes.md'],
    ['./My%20Notes%20%26%20Plans.md', '/docs/start.md', '/docs/My Notes & Plans.md'],
  ])('resolves %s from %s', (href, source, target) => {
    expect(resolveLinkedMarkdown(source, href)).toBe(target)
  })
  it.each(['/etc/passwd', 'file:///etc/passwd', 'http://example.com', '#heading', './bad%ZZ.md'])('rejects %s', href => {
    expect(() => resolveLinkedMarkdown('/docs/start.md', href)).toThrow()
  })
})

describe('openLinkedMarkdown', () => {
  const actions = () => ({
    realPath: async (target: string) => target,
    isGranted: async () => true,
    existingWindow: () => null as { focus(): void } | null,
    confirm: vi.fn(async () => true),
    open: vi.fn(),
    missing: vi.fn(),
  })
  it('opens an in-grant file in a new window', async () => {
    const a = actions()
    await openLinkedMarkdown('/docs/start.md', './next.md', a)
    expect(a.open).toHaveBeenCalledWith('/docs/next.md')
    expect(a.confirm).not.toHaveBeenCalled()
  })
  it('focuses a window already showing the target', async () => {
    const a = actions(), focus = vi.fn()
    a.existingWindow = () => ({ focus })
    await openLinkedMarkdown('/docs/start.md', './next.md', a)
    expect(focus).toHaveBeenCalledOnce()
    expect(a.open).not.toHaveBeenCalled()
  })
  it('asks before opening outside the grants', async () => {
    const a = actions()
    a.isGranted = async () => false
    a.confirm.mockResolvedValue(false)
    await openLinkedMarkdown('/docs/start.md', '../outside.md', a)
    expect(a.open).not.toHaveBeenCalled()
    a.confirm.mockResolvedValue(true)
    await openLinkedMarkdown('/docs/start.md', '../outside.md', a)
    expect(a.open).toHaveBeenCalledWith('/outside.md')
  })
  it('reports a missing target', async () => {
    const a = actions()
    a.realPath = async () => null
    await openLinkedMarkdown('/docs/start.md', './missing.md', a)
    expect(a.missing).toHaveBeenCalledWith('/docs/missing.md')
  })
})
