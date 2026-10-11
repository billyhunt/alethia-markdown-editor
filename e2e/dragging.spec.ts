/// <reference lib="dom" />
import { expect, test, type ElectronApplication } from '@playwright/test'
import { Sandbox, editorText, launch, promptsShown, answerSaveChanges, quit } from './harness.ts'

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

/** Records the native drags main starts instead of starting them. */
async function recordDrags(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const scope = globalThis as unknown as { __drags: string[] }
    scope.__drags = []
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.startDrag = ((item: { file: string }) => {
        scope.__drags.push(item.file)
      }) as typeof win.webContents.startDrag
    }
  })
}
const drags = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __drags: string[] }).__drags)

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

test.describe('dropping onto the window', () => {
  test('a file dropped on the editor is not pasted into the open document', async () => {
    const note = box.file('note.md', '# Note\n\nOriginal text.\n')
    const app = await launch(box, [note])
    const page = await app.firstWindow()
    await expect.poll(() => editorText(page)).toContain('Original text.')
    await answerSaveChanges(app, 'Cancel')

    const dataTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['dropped body'], 'other.md', { type: 'text/markdown' }))
      return transfer
    })
    await page.locator('.cm-content').dispatchEvent('drop', { dataTransfer })
    // CodeMirror reads a dropped file asynchronously before inserting it.
    await page.waitForTimeout(1000)

    expect(await editorText(page)).not.toContain('dropped body')
    expect(await promptsShown(app)).toEqual([])
    await quit(app)
  })
})
