/// <reference lib="dom" />
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { Sandbox, editorText, launch, windows, promptsShown, answerSaveChanges, quit } from './harness.ts'

/**
 * Dragging between the app and the rest of the desktop. A real OS drag cannot
 * be driven from a test, so these check the app's half of each one: what it
 * hands to macOS when a drag starts, and what it does with a drop.
 */

let box: Sandbox
test.beforeEach(() => {
  box = new Sandbox()
})
test.afterEach(() => {
  box.dispose()
})

interface Drag {
  file: string
  /** What main handed to macOS as the drag image. */
  icon: { empty: boolean; width: number; height: number }
}

/** Records the native drags main starts instead of starting them. */
async function recordDrags(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const scope = globalThis as unknown as { __drags: Drag[] }
    scope.__drags = []
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.startDrag = ((item: { file: string; icon: Electron.NativeImage }) => {
        const { width, height } = item.icon.getSize()
        scope.__drags.push({ file: item.file, icon: { empty: item.icon.isEmpty(), width, height } })
      }) as typeof win.webContents.startDrag
    }
  })
}
const allDrags = (app: ElectronApplication): Promise<Drag[]> =>
  app.evaluate(() => (globalThis as unknown as { __drags: Drag[] }).__drags)
const drags = async (app: ElectronApplication): Promise<string[]> => (await allDrags(app)).map((drag) => drag.file)

/**
 * Drops real files on the window the way the OS does: through Chromium's
 * input layer, so the page gets File objects that carry paths and the
 * preload can resolve them.
 */
async function dropFile(page: Page, filePath: string, at = { x: 400, y: 300 }): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  const data = { items: [], files: [filePath], dragOperationsMask: 1 }
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...at, data })
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...at, data })
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...at, data })
  await cdp.detach()
}

test.describe('dragging out of the sidebar', () => {
  test('a file leaves the window as that file, so a terminal types its path', async () => {
    const note = box.file('note.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    const row = page.locator('.tree-file', { hasText: 'note.md' })
    await expect(row).toBeVisible()
    await recordDrags(app)

    await row.dispatchEvent('dragstart')

    await expect.poll(() => drags(app)).toEqual([note])
    await quit(app)
  })

  test('the drag image is a real, decodable picture', async () => {
    box.file('note.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    const row = page.locator('.tree-file', { hasText: 'note.md' })
    await expect(row).toBeVisible()
    await recordDrags(app)

    // The first drag of a kind of file always uses the built-in page icon:
    // Finder's is only fetched once the drag has begun.
    await row.dispatchEvent('dragstart')

    await expect.poll(async () => (await allDrags(app)).length).toBe(1)
    const [drag] = await allDrags(app)
    expect(drag.icon).toEqual({ empty: false, width: 32, height: 32 })
    await quit(app)
  })

  test('a granted symlink pointing outside the workspace is not dragged', async () => {
    const secret = path.join(box.root, 'private.md')
    fs.writeFileSync(secret, '# private')
    fs.mkdirSync(box.docs, { recursive: true })
    fs.symlinkSync(secret, path.join(box.docs, 'link.md'))
    box.file('note.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    await expect(page.locator('.tree-file', { hasText: 'note.md' })).toBeVisible()
    await recordDrags(app)

    // The renderer asks for any path it likes; main decides.
    await page.evaluate((target) => (window as unknown as { api: { app: { startDrag(t: { path: string }): Promise<void> } } }).api.app.startDrag({ path: target }), path.join(box.docs, 'link.md'))
    await page.evaluate((target) => (window as unknown as { api: { app: { startDrag(t: { path: string }): Promise<void> } } }).api.app.startDrag({ path: target }), secret)

    expect(await drags(app)).toEqual([])
    await quit(app)
  })

  test('a folder can be dragged out too', async () => {
    box.file('nested/inside.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    const row = page.locator('.tree-dir', { hasText: 'nested' })
    await expect(row).toBeVisible()
    await recordDrags(app)

    await row.dispatchEvent('dragstart')

    await expect.poll(() => drags(app)).toEqual([`${box.docs}/nested`])
    await quit(app)
  })
})

test.describe('a sidebar drag released back over the window', () => {
  const representedFile = async (app: ElectronApplication): Promise<string | null> => (await windows(app))[0].file

  test('opens nothing, and the same item dropped from Finder afterwards does open', async () => {
    const note = box.file('note.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    const row = page.locator('.tree-file', { hasText: 'note.md' })
    await expect(row).toBeVisible()
    await recordDrags(app)

    await row.dispatchEvent('dragstart')
    await expect.poll(() => drags(app)).toEqual([note])
    await dropFile(page, note)
    await page.waitForTimeout(500)
    expect(await representedFile(app)).toBeNull()

    await dropFile(page, note)
    await expect.poll(() => representedFile(app)).toBe(note)
    await quit(app)
  })

  test('a folder row let go of over the window does not swap the workspace', async () => {
    const nested = path.join(box.docs, 'nested')
    box.file('nested/inside.md')
    box.file('top.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    const row = page.locator('.tree-dir', { hasText: 'nested' })
    await expect(row).toBeVisible()
    await recordDrags(app)

    await row.dispatchEvent('dragstart')
    await expect.poll(() => drags(app)).toEqual([nested])
    await dropFile(page, nested)
    await page.waitForTimeout(500)

    await expect(page.locator('.tree-file', { hasText: 'top.md' })).toBeVisible()
    await quit(app)
  })

  test('a drag that ended elsewhere does not swallow a later drop of the same file', async () => {
    const note = box.file('note.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    const row = page.locator('.tree-file', { hasText: 'note.md' })
    await expect(row).toBeVisible()
    await recordDrags(app)

    // Dropped in Terminal: this window sees nothing more of that drag.
    await row.dispatchEvent('dragstart')
    await expect.poll(() => drags(app)).toEqual([note])
    await app.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 60_000
    })
    await dropFile(page, note)

    await expect.poll(() => representedFile(app)).toBe(note)
    await quit(app)
  })
})

test.describe('dropping onto the window', () => {
  test('a file dropped on the editor is not pasted into the open document', async () => {
    const note = box.file('note.md', '# Note\n\nOriginal text.\n')
    const app = await launch(box, [note])
    const page = await app.firstWindow()
    await expect.poll(() => editorText(page)).toContain('Original text.')
    await answerSaveChanges(app, 'Cancel')

    const other = box.file('other.md', '# Other\n\ndropped body\n')
    const area = await page.locator('.cm-content').boundingBox()
    if (!area) throw new Error('the editor is not on screen')
    await dropFile(page, other, { x: area.x + area.width / 2, y: area.y + 20 })
    // CodeMirror reads a dropped file asynchronously before inserting it, and
    // the window's handler opens it.
    await expect.poll(async () => (await windows(app)).some((win) => win.file === other)).toBe(true)
    await page.waitForTimeout(1000)

    // The dropped file opened; its text was not also typed into a document.
    for (const win of app.windows()) {
      const text = await editorText(win)
      expect(text.includes('Original text.') && text.includes('dropped body')).toBe(false)
    }
    expect(await promptsShown(app)).toEqual([])
    await quit(app)
  })
})
