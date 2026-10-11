/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { Sandbox, chooseMenu, launch, quit } from './harness.ts'

/**
 * What lands in the file when the user pastes. Checked in the saved file, not
 * on screen, because live preview hides markdown syntax away from the caret.
 */

let box: Sandbox
test.beforeEach(() => {
  box = new Sandbox()
})
test.afterEach(() => {
  box.dispose()
})

/** Pastes as the system would after a copy from another app. */
async function paste(page: Page, data: { html?: string; text: string }): Promise<void> {
  await page.locator('.cm-content').evaluate((content, clip) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', clip.text)
    if (clip.html) transfer.setData('text/html', clip.html)
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, data)
}

async function openAtEnd(name: string, content: string) {
  const file = box.file(name, content)
  const app = await launch(box, [file])
  const page = await app.firstWindow()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  return { app, page, file }
}

async function savedText(app: Awaited<ReturnType<typeof launch>>, page: Page, file: string, expected: string) {
  await chooseMenu(app, page, 'File', 'Save')
  await expect.poll(() => box.read(file)).toContain(expected)
  return box.read(file)
}

test('rich text from a web page is pasted as markdown', async () => {
  const { app, page, file } = await openAtEnd('note.md', '# Note\n\n')
  await paste(page, {
    html: '<meta charset="utf-8"><h2>Plan</h2><p>See <a href="https://example.com">the docs</a>, <strong>today</strong>.</p><ul><li>one</li><li>two</li></ul>',
    text: 'Plan\nSee the docs, today.\none\ntwo',
  })
  const saved = await savedText(app, page, file, '## Plan')
  expect(saved).toContain('See [the docs](https://example.com), **today**.')
  expect(saved).toContain('- one\n- two')
  await quit(app)
})

test('inside a code block the plain text is pasted verbatim', async () => {
  const { app, page, file } = await openAtEnd('code.md', '```js\nconst a = 1\n')
  await paste(page, {
    html: '<meta charset="utf-8"><p><strong>let</strong> b = a * 2</p>',
    text: 'let b = a * 2',
  })
  const saved = await savedText(app, page, file, 'let b = a * 2')
  expect(saved).not.toContain('**let**')
  await quit(app)
})

test('plain text with no HTML pastes unchanged', async () => {
  const { app, page, file } = await openAtEnd('plain.md', '# Plain\n\n')
  await paste(page, { text: 'a * b_c [x]' })
  const saved = await savedText(app, page, file, 'a * b_c [x]')
  expect(saved).not.toContain('\\')
  await quit(app)
})

test('inside display math the plain text is pasted verbatim', async () => {
  const { app, page, file } = await openAtEnd('math.md', '$$\nx = ')
  await paste(page, { html: '<meta charset="utf-8"><p><em>a</em> * b</p>', text: 'a * b' })
  const saved = await savedText(app, page, file, 'x = a * b')
  expect(saved).not.toContain('\\*')
  await quit(app)
})

test('inside a table the plain text is pasted, not a whole new table', async () => {
  const { app, page, file } = await openAtEnd('table.md', '| a | b |\n| --- | --- |\n| 1 | ')
  await paste(page, {
    html: '<meta charset="utf-8"><table><tr><td><strong>two</strong></td></tr></table>',
    text: 'two',
  })
  const saved = await savedText(app, page, file, '| 1 | two')
  expect(saved).not.toContain('**two**')
  await quit(app)
})

test('inside front matter the plain text is pasted verbatim', async () => {
  const file = box.file('front.md', '---\ntitle: \n---\n\n# Body\n')
  const app = await launch(box, [file])
  const page = await app.firstWindow()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await paste(page, { html: '<meta charset="utf-8"><p><em>My</em> notes</p>', text: 'My notes' })
  const saved = await savedText(app, page, file, 'title: My notes')
  expect(saved).not.toContain('*My*')
  await quit(app)
})
