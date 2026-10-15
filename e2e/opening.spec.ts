import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  Sandbox,
  answerOpenDialog,
  answerSaveChanges,
  chooseMenu,
  editorText,
  expectDocuments,
  focusedFile,
  launch,
  openFiles,
  openFromFinder,
  pageFor,
  promptsShown,
  quit,
  typeInEditor,
  windows,
} from './harness.ts'

/**
 * How a document reaches the screen. Every way a user can ask for a file --
 * Finder, the command line, the Open dialog, the sidebar -- should end with
 * that file in exactly one window, and that window in front.
 */

/**
 * Marks a flow that fails today because of a bug; remove when it is fixed.
 * Exported so the suite still typechecks once no flow needs it.
 */
export const knownBug = (reason: string): void => test.fail(true, reason)

let box: Sandbox
test.beforeEach(() => {
  box = new Sandbox()
})
test.afterEach(() => {
  box.dispose()
})

test.describe('first launch', () => {
  test('a new user lands on the welcome tour, not an empty editor', async () => {
    knownBug('the welcome fetch is blocked by connect-src \'none\' in a built app (#41)')
    const app = await launch(box)
    const page = await app.firstWindow()
    await expect.poll(() => editorText(page)).toContain('Alethia')
    await quit(app)
  })

  test('the welcome tour is unsaved and never written into the app bundle', async () => {
    knownBug('the welcome fetch is blocked by connect-src \'none\' in a built app (#41)')
    const app = await launch(box)
    const page = await app.firstWindow()
    await expect.poll(() => editorText(page)).toContain('Alethia')
    expect(await openFiles(app)).toEqual([null])
    await quit(app)
  })
})

test.describe('quitting', () => {
  test('quitting right after launch, before the window has loaded, quits', async () => {
    const app = await launch(box)
    const exited = new Promise((resolve) => app.process().once('exit', resolve))
    await app.evaluate(({ app: electronApp }) => electronApp.quit())
    await expect(Promise.race([exited.then(() => 'exited'), new Promise((r) => setTimeout(() => r('stuck'), 5000))])).resolves.toBe('exited')
  })
})

test.describe('opening from the command line', () => {
  test('a file named on launch is the document shown, in front', async () => {
    const note = box.file('note.md')
    const app = await launch(box, [note])
    await expectDocuments(app, [note])
    expect(await focusedFile(app)).toBe(note)
    await quit(app)
  })

  test('several files named on launch each get a window', async () => {
    const files = [box.file('one.md'), box.file('two.md'), box.file('three.md')]
    const app = await launch(box, files)
    await expectDocuments(app, files)
    await quit(app)
  })

  test('a folder named on launch opens in the sidebar', async () => {
    box.file('inside.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    await expect(page.locator('.tree-file', { hasText: 'inside.md' })).toBeVisible()
    await quit(app)
  })

  test('a non-markdown file is ignored rather than opened', async () => {
    const binary = path.join(box.docs, 'image.png')
    fs.writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const app = await launch(box, [binary])
    await expectDocuments(app, [null])
    await quit(app)
  })
})

test.describe('opening from Finder while running', () => {
  test('the first file replaces the untouched welcome tour', async () => {
    const note = box.file('note.md')
    const app = await launch(box)
    await app.firstWindow()
    await openFromFinder(app, note)
    await expectDocuments(app, [note])
    expect(await focusedFile(app)).toBe(note)
    await quit(app)
  })

  test('a second file opens in its own window and comes to the front', async () => {
    const first = box.file('first.md')
    const second = box.file('second.md')
    const app = await launch(box, [first])
    await expectDocuments(app, [first])
    await openFromFinder(app, second)
    await expectDocuments(app, [first, second])
    await expect.poll(() => focusedFile(app)).toBe(second)
    await quit(app)
  })

  test('selecting several files in Finder opens every one of them', async () => {
    const files = [box.file('a.md'), box.file('b.md'), box.file('c.md')]
    const app = await launch(box)
    await app.firstWindow()
    await openFromFinder(app, ...files)
    await expectDocuments(app, files)
    await quit(app)
  })

  test('opening a file that is already open brings its window forward', async () => {
    const first = box.file('first.md')
    const second = box.file('second.md')
    const app = await launch(box, [first])
    await expectDocuments(app, [first])
    await openFromFinder(app, second)
    await expect.poll(() => focusedFile(app)).toBe(second)

    await openFromFinder(app, first)
    await expect.poll(() => focusedFile(app)).toBe(first)
    expect(await openFiles(app)).toHaveLength(2)
    await quit(app)
  })

  test('the same file spelled through a symlink is still one window', async () => {
    const note = box.file('note.md')
    const alias = path.join(box.root, 'alias')
    fs.symlinkSync(box.docs, alias)
    const app = await launch(box, [note])
    await expectDocuments(app, [note])
    await openFromFinder(app, path.join(alias, 'note.md'))
    // Give a wrong second window time to appear before counting.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await windows(app)).toHaveLength(1)
    await quit(app)
  })

  test('unsaved untitled text is never displaced or prompted over by a Finder open', async () => {
    const note = box.file('note.md')
    const app = await launch(box)
    const page = await app.firstWindow()
    await expect(page.locator('.cm-content')).toBeVisible()
    await chooseMenu(app, page, 'File', 'New')
    await typeInEditor(page, 'draft I have not saved')
    await answerSaveChanges(app, 'Cancel')

    await openFromFinder(app, note)
    await expect.poll(() => openFiles(app)).toContain(note)
    expect(await promptsShown(app)).toEqual([])
    const draft = await pageFor(app, null)
    expect(await editorText(draft)).toContain('draft I have not saved')
    await quit(app)
  })
})

test.describe('opening from inside a window', () => {
  test('File > Open on a file open in another window brings that window forward', async () => {
    const first = box.file('first.md')
    const second = box.file('second.md')
    const app = await launch(box, [first])
    await expectDocuments(app, [first])
    await openFromFinder(app, second)
    await expect.poll(() => focusedFile(app)).toBe(second)

    // From the second window, ask for the first file again.
    await answerOpenDialog(app, first)
    await chooseMenu(app, await pageFor(app, second), 'File', 'Open…')

    await expect.poll(() => focusedFile(app)).toBe(first)
    await expectDocuments(app, [first, second])
    await quit(app)
  })

  test('clicking a sidebar file that is open in another window does not open a second copy', async () => {
    const first = box.file('first.md')
    const app = await launch(box, [box.docs])
    const page = await app.firstWindow()
    await page.locator('.tree-file', { hasText: 'first.md' }).click()
    await expectDocuments(app, [first])

    // The same folder again from Finder: the first window is busy, so this
    // makes a second window on the folder with no document.
    await openFromFinder(app, box.docs)
    await expectDocuments(app, [first, null])
    const second = await pageFor(app, null)
    await second.locator('.tree-file', { hasText: 'first.md' }).click()

    await expect.poll(() => focusedFile(app)).toBe(first)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect((await openFiles(app)).filter((file) => file === first)).toHaveLength(1)
    await quit(app)
  })

  test('two windows never end up editing the same file', async () => {
    const shared = box.file('shared.md', '# Shared\n')
    const other = box.file('other.md')
    const app = await launch(box, [shared])
    await expectDocuments(app, [shared])
    await openFromFinder(app, other)
    await expect.poll(() => focusedFile(app)).toBe(other)

    await answerOpenDialog(app, shared)
    await chooseMenu(app, await pageFor(app, other), 'File', 'Open…')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const copies = (await openFiles(app)).filter((file) => file === shared)
    expect(copies).toHaveLength(1)
    await quit(app)
  })
})

test.describe('session restore', () => {
  test('quitting and relaunching puts every document back', async () => {
    const files = [box.file('one.md'), box.file('two.md')]
    let app = await launch(box, [files[0]])
    await expectDocuments(app, [files[0]])
    await openFromFinder(app, files[1])
    await expectDocuments(app, files)
    await quit(app)

    app = await launch(box)
    await expectDocuments(app, files)
    await quit(app)
  })

  test('a file opened at launch is in front of the windows the session restores', async () => {
    const restored = [box.file('old-one.md'), box.file('old-two.md')]
    const wanted = box.file('wanted.md')
    box.settings({
      windows: restored.map((file) => ({ bounds: { width: 900, height: 600 }, folder: null, file })),
    })
    const app = await launch(box, [wanted])
    await expect.poll(() => openFiles(app)).toContain(wanted)
    await expect.poll(() => focusedFile(app), { timeout: 10_000 }).toBe(wanted)
    // The restored documents are still there, behind it.
    await expect.poll(async () => (await openFiles(app)).filter(Boolean).sort()).toEqual(
      [...restored, wanted].sort(),
    )
    await quit(app)
  })

  test('a file opened at launch does not replace a restored document', async () => {
    const restored = box.file('restored.md')
    const wanted = box.file('wanted.md')
    box.settings({ windows: [{ bounds: { width: 900, height: 600 }, folder: null, file: restored }] })
    const app = await launch(box, [wanted])
    await expectDocuments(app, [restored, wanted])
    await quit(app)
  })

  test('a file opened at launch does not hide a restored folder', async () => {
    box.file('inside.md')
    const wanted = box.file('wanted.md')
    box.settings({ windows: [{ bounds: { width: 900, height: 600 }, folder: box.docs, file: null }] })
    const app = await launch(box, [wanted])
    await expectDocuments(app, [null, wanted])
    const restored = await pageFor(app, null)
    await expect(restored.locator('.tree-file', { hasText: 'inside.md' })).toBeVisible()
    await quit(app)
  })

  test('a document saved in two windows is restored into one', async () => {
    const twice = box.file('twice.md')
    box.settings({
      windows: [1, 2].map(() => ({ bounds: { width: 900, height: 600 }, folder: null, file: twice })),
    })
    const app = await launch(box)
    await expectDocuments(app, [twice, null])
    await quit(app)
  })

  test('a restored document that was deleted meanwhile falls back cleanly', async () => {
    const gone = path.join(box.docs, 'gone.md')
    box.settings({ windows: [{ bounds: { width: 900, height: 600 }, folder: null, file: gone }] })
    const app = await launch(box)
    const page = await app.firstWindow()
    await expect.poll(() => openFiles(app)).toEqual([null])
    await expect(page.locator('.cm-content')).toBeVisible()
    await quit(app)
  })
})

test.describe('second launch', () => {
  test('launching again with a file hands it to the running app', async () => {
    const first = box.file('first.md')
    const second = box.file('second.md')
    const app = await launch(box, [first])
    await expectDocuments(app, [first])

    const again = await launch(box, [second]).catch(() => null)
    await again?.close().catch(() => undefined)

    await expectDocuments(app, [first, second])
    await expect.poll(() => focusedFile(app)).toBe(second)
    await quit(app)
  })
})
