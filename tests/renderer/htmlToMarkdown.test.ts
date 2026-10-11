import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../../src/renderer/editor/htmlToMarkdown.ts'

// Chromium puts this wrapper around every HTML copy.
const clip = (body: string) => `<meta charset="utf-8">${body}`

describe('pasting rich text as markdown', () => {
  it('keeps headings, emphasis, links and lists from a web page', () => {
    const html = clip(
      '<h2>Release notes</h2><p>Read the <a href="https://example.com/guide">guide</a> ' +
        'for <strong>breaking</strong> and <em>minor</em> changes.</p>' +
        '<ul><li>First</li><li>Second<ul><li>Nested</li></ul></li></ul><ol><li>One</li><li>Two</li></ol>',
    )
    expect(htmlToMarkdown(html)).toBe(
      [
        '## Release notes',
        '',
        'Read the [guide](https://example.com/guide) for **breaking** and *minor* changes.',
        '',
        '- First',
        '- Second',
        '  - Nested',
        '',
        '1. One',
        '2. Two',
      ].join('\n'),
    )
  })

  it('turns code blocks into fenced code and keeps inline code', () => {
    const html = clip('<p>Run <code>npm ci</code> then:</p><pre><code>npm run build\nnpm test</code></pre>')
    expect(htmlToMarkdown(html)).toBe('Run `npm ci` then:\n\n```\nnpm run build\nnpm test\n```')
  })

  it('converts a table to a GFM table, escaping pipes in cells', () => {
    const html = clip(
      '<table><thead><tr><th>Name</th><th>Value</th></tr></thead>' +
        '<tbody><tr><td>a | b</td><td><strong>1</strong></td></tr><tr><td>c</td><td>2</td></tr></tbody></table>',
    )
    expect(htmlToMarkdown(html)).toBe(
      ['| Name | Value |', '| --- | --- |', '| a \\| b | **1** |', '| c | 2 |'].join('\n'),
    )
  })

  it('uses the first row as the header of a table without one', () => {
    const html = clip('<table><tr><td>x</td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(htmlToMarkdown(html)).toBe(['| x | y |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
  })

  it('understands Google Docs, which styles text instead of marking it up', () => {
    const html = clip(
      '<b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr">' +
        '<span style="font-weight:700;">Bold</span><span style="font-weight:400;"> and </span>' +
        '<span style="font-style:italic;">italic</span></p></b>',
    )
    expect(htmlToMarkdown(html)).toBe('**Bold** and *italic*')
  })

  it('keeps strikethrough and task lists', () => {
    const html = clip(
      '<p><del>old</del> new</p><ul><li><input type="checkbox" checked disabled> done</li>' +
        '<li><input type="checkbox" disabled> todo</li></ul>',
    )
    expect(htmlToMarkdown(html)).toBe('~~old~~ new\n\n- [x] done\n- [ ] todo')
  })

  it('escapes text that would otherwise turn into markdown', () => {
    expect(htmlToMarkdown(clip('<p><em>Note</em>: 2 * 3 = 6</p><p>1. not a list</p>'))).toBe(
      '*Note*: 2 \\* 3 = 6\n\n1\\. not a list',
    )
  })

  it('numbers an ordered list from its start, and indents nested lines under the text', () => {
    const html = clip('<ol start="3"><li>Third<ul><li>child</li></ul></li><li>Fourth</li></ol>')
    expect(htmlToMarkdown(html)).toBe('3. Third\n   - child\n4. Fourth')
  })

  it('drops styles and scripts rather than pasting them as text', () => {
    const html = clip('<style>p{color:red}</style><script>alert(1)</script><p><b>kept</b></p>')
    expect(htmlToMarkdown(html)).toBe('**kept**')
  })

  it('leaves plain styled text from a code editor or terminal to the plain-text paste', () => {
    // VS Code's copy: styled divs and spans around code, nothing semantic.
    const vscode = clip(
      '<div style="color: #d4d4d4;background-color: #1e1e1e;"><div><span style="color: #569cd6;">const</span>' +
        '<span> x = a * b_c;</span></div></div>',
    )
    expect(htmlToMarkdown(vscode)).toBeNull()
    expect(htmlToMarkdown(clip('<span>just words</span>'))).toBeNull()
  })

  it('does not count the Google Docs wrapper as bold on its own', () => {
    const html = clip('<b style="font-weight:normal;" id="docs-internal-guid-1"><span>plain</span></b>')
    expect(htmlToMarkdown(html)).toBeNull()
  })

  it('gives up on HTML with nothing in it', () => {
    expect(htmlToMarkdown(clip('<p><a href="#">   </a></p>'))).toBeNull()
  })

  it('leaves code from an editor theme with bold or italic keywords alone', () => {
    const vscode = clip(
      '<div style="white-space: pre;"><div><span style="font-style: italic;color: #c586c0;">import</span>' +
        '<span> { a_b } </span><span style="font-weight: bold;">from</span><span> \'x\'</span></div></div>',
    )
    expect(htmlToMarkdown(vscode)).toBeNull()
  })

  it('leaves a JetBrains copy, a styled <pre> with no <code>, alone', () => {
    expect(htmlToMarkdown(clip('<pre style="background-color:#2b2b2b;color:#a9b7c6">val x = a * b_c</pre>'))).toBeNull()
  })

  it('fences a bare <pre> that comes with other content', () => {
    expect(htmlToMarkdown(clip('<p><strong>Run:</strong></p><pre>make * all</pre>'))).toBe(
      '**Run:**\n\n```\nmake * all\n```',
    )
  })

  it('keeps bold, italic and strikethrough together on one Google Docs span', () => {
    const html = clip(
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700;font-style:italic;">both</span>' +
        '<span> and </span><span style="text-decoration:line-through;">gone</span></b>',
    )
    expect(htmlToMarkdown(html)).toBe('***both*** and ~~gone~~')
  })

  it('pads merged cells so no column is dropped', () => {
    const html = clip('<table><tr><th colspan="2">Both</th></tr><tr><td>a</td><td>b</td></tr></table>')
    expect(htmlToMarkdown(html)).toBe(['| Both | |', '| --- | --- |', '| a | b |'].join('\n'))
  })

  it('puts a table caption above the table rather than inside it', () => {
    const html = clip('<table><caption>Results</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>')
    expect(htmlToMarkdown(html)).toBe(['Results', '', '| A |', '| --- |', '| 1 |'].join('\n'))
  })

  it('keeps only the alt text of inline-data and temp-file images', () => {
    const html = clip(
      `<p><strong>Chart</strong> <img alt="sales" src="data:image/png;base64,${'A'.repeat(500)}"> ` +
        '<img alt="logo" src="file:///var/folders/x/clip_image001.png"> ' +
        '<img alt="web" src="https://example.com/a.png"></p>',
    )
    expect(htmlToMarkdown(html)).toBe('**Chart** sales logo ![web](https://example.com/a.png)')
  })

  it('drops the bullet text Word puts in front of list paragraphs', () => {
    const html = clip(
      '<p class="MsoListParagraph"><span style="mso-list:Ignore">·<span>    </span></span><b>Item</b> one</p>',
    )
    expect(htmlToMarkdown(html)).toBe('**Item** one')
  })

  it('numbers from 1 when a list start is not a number', () => {
    expect(htmlToMarkdown(clip('<ol start="x"><li>a</li></ol>'))).toBe('1. a')
  })

  it('converts a large spreadsheet paste in linear time', () => {
    const row = (i: number) => `<tr>${Array.from({ length: 8 }, (_, c) => `<td>${i}-${c}</td>`).join('')}</tr>`
    const table = (rows: number) => clip(`<table>${Array.from({ length: rows }, (_, i) => row(i)).join('')}</table>`)
    const time = (rows: number) => {
      const started = performance.now()
      htmlToMarkdown(table(rows))
      return performance.now() - started
    }
    time(200) // warm up
    const small = time(500)
    const large = time(2000)
    // Four times the rows; quadratic work would take about sixteen times as long.
    expect(large).toBeLessThan(small * 8 + 50)
  })

  it('keeps empty cells and skips empty rows', () => {
    const html = clip('<table><tr><th>A</th><th></th></tr><tr></tr><tr><td></td><td>2</td></tr></table>')
    expect(htmlToMarkdown(html)).toBe(['| A |  |', '| --- | --- |', '|  | 2 |'].join('\n'))
  })

  it('fences code containing backticks with a longer fence, keeping its line breaks', () => {
    const html = clip('<p><b>x</b></p><pre>a<br>```<br>b</pre>')
    expect(htmlToMarkdown(html)).toBe('**x**\n\n````\na\n```\nb\n````')
  })

  it('caps a runaway colspan', () => {
    const markdown = htmlToMarkdown(clip('<table><tr><td colspan="100000">x</td></tr></table>')) ?? ''
    expect(markdown.split('\n')[0].split('|').length).toBeLessThanOrEqual(1002)
  })
})
