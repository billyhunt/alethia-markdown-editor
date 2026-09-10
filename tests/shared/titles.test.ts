import { describe, expect, it } from 'vitest'
import { documentTitle, fileNameForDocument, fileNameForTitle } from '../../src/shared/titles.ts'

describe('documentTitle', () => {
  it('prefers the first heading', () => {
    expect(documentTitle('\n\n# Release notes\n\nBody text\n')).toBe('Release notes')
  })

  it('falls back to the first line of prose', () => {
    expect(documentTitle('Just a thought\n\n# Later heading\n')).toBe('Just a thought')
  })

  it('skips front matter, rules and fences', () => {
    expect(documentTitle('---\ntitle: meta\n---\n\n# Real title\n')).toBe('Real title')
    expect(documentTitle('---\n\n***\n\nFirst words\n')).toBe('First words')
    expect(documentTitle('```\ncode\n```\n\nAfter the block\n')).toBe('After the block')
  })

  it('reads through markdown syntax', () => {
    expect(documentTitle('## **Bold** _title_ with `code`')).toBe('Bold title with code')
    expect(documentTitle('- [ ] [Ship it](https://example.com) today')).toBe('Ship it today')
    expect(documentTitle('> Quoted   opening    line')).toBe('Quoted opening line')
  })

  it('has nothing to say about an empty buffer', () => {
    expect(documentTitle('')).toBeNull()
    expect(documentTitle('\n   \n\t\n')).toBeNull()
  })
})

describe('fileNameForTitle', () => {
  it('adds a markdown extension, keeping one already there', () => {
    expect(fileNameForTitle('Meeting notes')).toBe('Meeting notes.md')
    expect(fileNameForTitle('README.md')).toBe('README.md')
  })

  it('removes characters a path may not contain', () => {
    expect(fileNameForTitle('2026/09/10: standup')).toBe('2026-09-10- standup.md')
    expect(fileNameForTitle('a\u0000b')).toBe('a-b.md')
  })

  it('refuses to create a hidden or flag-like file', () => {
    expect(fileNameForTitle('.env notes')).toBe('env notes.md')
    expect(fileNameForTitle('--force')).toBe('force.md')
  })

  it('truncates on a word boundary', () => {
    const name = fileNameForTitle(`${'word '.repeat(30)}end`)!
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^(word )+word\.md$/)
  })

  it('truncates mid-word rather than losing the sense of a long one', () => {
    const name = fileNameForTitle('a'.repeat(100))!
    expect(name).toBe(`${'a'.repeat(60)}.md`)
  })

  it('gives up when nothing usable survives', () => {
    expect(fileNameForTitle('///')).toBeNull()
    expect(fileNameForTitle('   ')).toBeNull()
  })
})

describe('fileNameForDocument', () => {
  it('names a document after its title', () => {
    expect(fileNameForDocument('# Q3 planning\n\nnotes\n')).toBe('Q3 planning.md')
  })

  it('waits until there is a title', () => {
    expect(fileNameForDocument('#  \n')).toBeNull()
    expect(fileNameForDocument('')).toBeNull()
  })
})
