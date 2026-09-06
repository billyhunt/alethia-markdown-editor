import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdownExtension } from '../../src/renderer/editor/markdownLanguage.ts'
import { countChars, countWords, extractOutline } from '../../src/renderer/editor/docStats.ts'

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdownExtension] })

describe('countWords', () => {
  it('counts plain words', () => {
    expect(countWords('one two three')).toBe(3)
  })

  it('treats an internal apostrophe or hyphen as part of one word', () => {
    expect(countWords("don't")).toBe(1)
    expect(countWords('well-known')).toBe(1)
    expect(countWords('it’s fine')).toBe(2)
  })

  it('ignores punctuation and collapses whitespace', () => {
    expect(countWords('  hello,   world!  ')).toBe(2)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('counts words with digits and accents', () => {
    expect(countWords('café 42 naïve')).toBe(3)
  })

  it('counts markdown syntax characters as part of no word', () => {
    // The markers are punctuation, so **bold** is one word, not three.
    expect(countWords('**bold**')).toBe(1)
  })
})

describe('countChars', () => {
  it('excludes line separators, as writing tools do', () => {
    // "ab\ncd" is 5 characters of document but 4 of text.
    expect(countChars(stateOf('ab\ncd'))).toBe(4)
  })

  it('counts a single line as its own length', () => {
    expect(countChars(stateOf('hello'))).toBe(5)
  })

  it('is zero for an empty document', () => {
    expect(countChars(stateOf(''))).toBe(0)
  })
})

describe('extractOutline', () => {
  it('lists ATX headings with their level, text and position', () => {
    const doc = ['# One', '', 'body', '', '## Two', '', '### Three'].join('\n')
    const outline = extractOutline(stateOf(doc))
    expect(outline.map((e) => [e.level, e.text])).toEqual([
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three'],
    ])
    expect(stateOf(doc).doc.sliceString(outline[1].pos, outline[1].pos + 6)).toBe('## Two')
  })

  it('strips leading and closing hashes', () => {
    expect(extractOutline(stateOf('## Two ##'))[0].text).toBe('Two')
  })

  it('includes setext headings', () => {
    const outline = extractOutline(stateOf(['Title', '=====', '', 'Sub', '---'].join('\n')))
    expect(outline.map((e) => [e.level, e.text])).toEqual([
      [1, 'Title'],
      [2, 'Sub'],
    ])
  })

  it('ignores a hash that is not a heading', () => {
    expect(extractOutline(stateOf('a # b'))).toEqual([])
  })

  it('does not treat a comment inside a code fence as a heading', () => {
    const doc = ['```py', '# not a heading', '```'].join('\n')
    expect(extractOutline(stateOf(doc))).toEqual([])
  })

  it('skips a heading whose text is empty', () => {
    expect(extractOutline(stateOf('#'))).toEqual([])
  })
})
