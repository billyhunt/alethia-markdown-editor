import { describe, expect, it } from 'vitest'
import { isMarkdownPath, isReadablePath, IGNORED_DIR_NAMES } from '../../src/shared/markdown.ts'

describe('isMarkdownPath', () => {
  it.each(['/a/b/notes.md', '/a/notes.markdown', '/a/notes.mdown', '/a/notes.mkd'])(
    'accepts %s',
    (p) => expect(isMarkdownPath(p)).toBe(true),
  )

  it('is case-insensitive about the extension', () => {
    expect(isMarkdownPath('/a/NOTES.MD')).toBe(true)
  })

  it.each(['/a/notes.txt', '/a/script.sh', '/a/notes', '/a/.md', '/a/notes.md.sh'])(
    'rejects %s',
    (p) => expect(isMarkdownPath(p)).toBe(false),
  )

  it('does not treat a dot in a directory name as an extension', () => {
    // The dot is before the last separator, so there is no extension at all.
    expect(isMarkdownPath('/a/v1.2/notes')).toBe(false)
  })

  it('accepts a markdown file inside a dotted directory', () => {
    expect(isMarkdownPath('/a/v1.2/notes.md')).toBe(true)
  })
})

describe('isReadablePath', () => {
  it('additionally allows plain text', () => {
    expect(isReadablePath('/a/notes.txt')).toBe(true)
    expect(isMarkdownPath('/a/notes.txt')).toBe(false)
  })

  it('still rejects executables', () => {
    expect(isReadablePath('/a/run.sh')).toBe(false)
  })
})

describe('IGNORED_DIR_NAMES', () => {
  it('covers the directories a markdown workspace never wants walked', () => {
    expect(IGNORED_DIR_NAMES).toEqual(
      expect.arrayContaining(['node_modules', '.git', 'dist', 'build']),
    )
  })
})
