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

  it('treats --- as front matter only when metadata follows it', () => {
    // A thematic break above a heading is not front matter.
    expect(documentTitle('---\n# Real title\n---\nBody\n')).toBe('Real title')
    expect(documentTitle('---\ntags: [a]\n---\n# Real title\n')).toBe('Real title')
  })

  it('still finds a title under an unterminated code fence', () => {
    // Otherwise the document would never be filed, and never say why.
    expect(documentTitle('```js\nconst a = 1\n\n# Actual title\n')).toBe('Actual title')
  })

  it('ignores plumbing that happens to come first', () => {
    expect(documentTitle('<!-- markdownlint-disable -->\n# Real title\n')).toBe('Real title')
    expect(documentTitle('<!--\nlicence\nblock\n-->\n# Real title\n')).toBe('Real title')
    expect(documentTitle('[1]: https://example.com\n\n# Real title\n')).toBe('Real title')
  })

  it('reads a leading table row as its cells', () => {
    expect(documentTitle('| Name | Value |\n|---|---|\n| a | b |\n')).toBe('Name Value')
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
    // Punctuation only, once separators have become dashes.
    expect(fileNameForTitle('<<>>')).toBeNull()
  })

  it('removes characters that would misrepresent the name', () => {
    // U+202E would reverse how the rest of the name renders in Finder.
    expect(fileNameForTitle('report\u202egnp.md')).toBe('report-gnp.md')
  })

  it('never cuts a surrogate pair in half', () => {
    // A lone surrogate is stored as U+FFFD, giving a file whose name can
    // never match the title it came from.
    const name = fileNameForTitle('🎉'.repeat(70))!
    expect(name).not.toContain('\ufffd')
    expect(Array.from(name.replace(/\.md$/, ''))).toHaveLength(60)
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
