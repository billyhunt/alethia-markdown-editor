import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-watch-userdata')
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { grantRoot } = await import('../../src/main/paths.ts')
const { readTextFile, writeTextFile } = await import('../../src/main/files.ts')
const { closeAllWatchers, closeWatchersFor, unwatchDocument, watchDocument, watchedWindowCount } =
  await import('../../src/main/watcher.ts')

/**
 * A stand-in for BrowserWindow carrying only what the watcher touches: an id,
 * a destroyed flag, and somewhere for its events to land.
 */
function fakeWindow(id: number) {
  const received: Array<{ channel: string; payload: unknown }> = []
  return {
    id,
    received,
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => received.push({ channel, payload }),
    },
  }
}

type FakeWindow = ReturnType<typeof fakeWindow>
const asWindow = (win: FakeWindow) => win as unknown as Parameters<typeof watchDocument>[0]

let root: string
const at = (name: string) => path.join(root, name)
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-watch-'))
  grantRoot(root)
})

afterEach(async () => {
  await closeAllWatchers()
})

afterAll(async () => {
  await closeAllWatchers()
  await fs.rm(root, { recursive: true, force: true })
})

describe('per-window document watching', () => {
  it('delivers a change only to the window watching that file', async () => {
    const one = fakeWindow(1)
    const two = fakeWindow(2)
    const fileOne = at('one.md')
    const fileTwo = at('two.md')
    await fs.writeFile(fileOne, '# one\n')
    await fs.writeFile(fileTwo, '# two\n')
    await readTextFile(fileOne)
    await readTextFile(fileTwo)

    await watchDocument(asWindow(one), fileOne)
    await watchDocument(asWindow(two), fileTwo)

    // Something else edits the first file.
    await fs.writeFile(fileOne, '# one, changed elsewhere\n')
    await settle()

    expect(one.received.map((e) => e.channel)).toContain('host:fileChanged')
    // The other window is showing a different document and must hear nothing.
    expect(two.received).toHaveLength(0)
  })

  it('lets two windows watch without cancelling each other', async () => {
    const one = fakeWindow(1)
    const two = fakeWindow(2)
    const fileOne = at('a.md')
    const fileTwo = at('b.md')
    await fs.writeFile(fileOne, 'a\n')
    await fs.writeFile(fileTwo, 'b\n')
    await readTextFile(fileOne)
    await readTextFile(fileTwo)

    await watchDocument(asWindow(one), fileOne)
    await watchDocument(asWindow(two), fileTwo)
    expect(watchedWindowCount()).toBe(2)

    // A single shared watcher would have been replaced by the second call,
    // leaving the first window deaf.
    await fs.writeFile(fileOne, 'a changed\n')
    await fs.writeFile(fileTwo, 'b changed\n')
    await settle()

    expect(one.received.length).toBeGreaterThan(0)
    expect(two.received.length).toBeGreaterThan(0)
  })

  it('reports a deletion to its own window', async () => {
    const win = fakeWindow(1)
    const file = at('gone.md')
    await fs.writeFile(file, 'x\n')
    await readTextFile(file)
    await watchDocument(asWindow(win), file)

    await fs.rm(file)
    await settle()

    const removals = win.received.filter(
      (e) => (e.payload as { kind?: string }).kind === 'removed',
    )
    expect(removals.length).toBeGreaterThan(0)
  })

  it('stays silent for the app’s own save', async () => {
    const win = fakeWindow(1)
    const file = at('own.md')
    await fs.writeFile(file, 'first\n')
    const read = await readTextFile(file)
    await watchDocument(asWindow(win), file)

    // Echo suppression: a write we made must not come back as an edit.
    await writeTextFile(file, 'second\n', { lineEnding: read.lineEnding })
    await settle()

    expect(win.received).toHaveLength(0)
  })
})

describe('watcher lifetime', () => {
  it('drops a window’s watchers when it closes', async () => {
    const win = fakeWindow(7)
    const file = at('closing.md')
    await fs.writeFile(file, 'x\n')
    await readTextFile(file)
    await watchDocument(asWindow(win), file)
    expect(watchedWindowCount()).toBe(1)

    await closeWatchersFor(win.id)
    expect(watchedWindowCount()).toBe(0)

    // Nothing should reach a window that no longer exists.
    await fs.writeFile(file, 'changed after close\n')
    await settle()
    expect(win.received).toHaveLength(0)
  })

  it('unwatching one window leaves the other watching', async () => {
    const one = fakeWindow(1)
    const two = fakeWindow(2)
    const fileOne = at('keep.md')
    const fileTwo = at('drop.md')
    await fs.writeFile(fileOne, 'x\n')
    await fs.writeFile(fileTwo, 'y\n')
    await readTextFile(fileOne)
    await readTextFile(fileTwo)

    await watchDocument(asWindow(one), fileOne)
    await watchDocument(asWindow(two), fileTwo)
    await unwatchDocument(asWindow(two))

    await fs.writeFile(fileOne, 'x changed\n')
    await fs.writeFile(fileTwo, 'y changed\n')
    await settle()

    expect(one.received.length).toBeGreaterThan(0)
    expect(two.received).toHaveLength(0)
  })
})
