import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import chokidar from 'chokidar'
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

/** For asserting that nothing happens: long enough for a stray event to show. */
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * For asserting that something does happen. An event arrives only after the
 * watcher's write-stability window, so wait for it rather than guessing how
 * long a loaded machine needs.
 */
const eventually = (assertion: () => void) => vi.waitFor(assertion, { timeout: 5000, interval: 25 })

/**
 * Records, for every watcher chokidar creates, whether it has said 'ready', so
 * a test can see what state it is in at the moment `watchDocument` returns.
 * `created` settles the moment the first watcher exists, before any of its
 * asynchronous startup can have run.
 */
function trackWatchers() {
  const watchers: Array<{ ready: boolean }> = []
  const { promise: created, resolve: notifyCreated } = Promise.withResolvers<void>()
  const original = chokidar.watch.bind(chokidar)
  vi.spyOn(chokidar, 'watch').mockImplementation((paths, options) => {
    const watcher = original(paths, options)
    const record = { ready: false }
    // Registered before the watcher under test can add its own listener, so
    // this runs first when 'ready' is emitted.
    watcher.once('ready', () => { record.ready = true })
    watchers.push(record)
    notifyCreated()
    return watcher
  })
  return { watchers, created }
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-watch-'))
  grantRoot(root)
})

afterEach(async () => {
  vi.restoreAllMocks()
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
    await eventually(() => {
      expect(one.received.map((e) => e.channel)).toContain('host:fileChanged')
    })

    // The other window is showing a different document and must hear nothing.
    await settle(300)
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

    await eventually(() => {
      expect(one.received.length).toBeGreaterThan(0)
      expect(two.received.length).toBeGreaterThan(0)
    })
  })

  it('reports a deletion to its own window', async () => {
    const win = fakeWindow(1)
    const file = at('gone.md')
    await fs.writeFile(file, 'x\n')
    await readTextFile(file)
    await watchDocument(asWindow(win), file)

    await fs.rm(file)

    await eventually(() => {
      const removals = win.received.filter(
        (e) => (e.payload as { kind?: string }).kind === 'removed',
      )
      expect(removals.length).toBeGreaterThan(0)
    })
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

    await eventually(() => {
      expect(one.received.length).toBeGreaterThan(0)
    })
    await settle(300)
    expect(two.received).toHaveLength(0)
  })
})

describe('arming a document watch', () => {
  // chokidar.watch() returns before anything is being watched. Reporting the
  // watch as established at that point lost any edit made straight afterwards:
  // 31 of 40 on Linux and 1 of 40 on macOS in a bare loop.
  it('is not reported as established until the watcher is ready', async () => {
    const win = fakeWindow(1)
    const file = at('arming.md')
    await fs.writeFile(file, 'x\n')
    await readTextFile(file)
    const { watchers } = trackWatchers()

    await watchDocument(asWindow(win), file)

    expect(watchers).toHaveLength(1)
    expect(watchers[0].ready).toBe(true)
  })

  it('sees an edit made the moment the watch is reported established', async () => {
    const win = fakeWindow(1)
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = at(`immediate-${attempt}.md`)
      await fs.writeFile(file, 'before\n')
      await readTextFile(file)
      win.received.length = 0

      await watchDocument(asWindow(win), file)
      await fs.writeFile(file, `after ${attempt}, and longer\n`)

      await eventually(() => {
        expect(win.received.map((e) => e.channel)).toContain('host:fileChanged')
      })
    }
  })

  // close() drops chokidar's listeners, so a watcher closed before it was ready
  // would never say so and the caller would wait forever.
  describe.each([
    ['the window closes', (win: FakeWindow) => closeWatchersFor(win.id)],
    ['the document is unwatched', (win: FakeWindow) => unwatchDocument(asWindow(win))],
    [
      'another document replaces it',
      (win: FakeWindow) => {
        // Resolve paths without I/O, so the replacement closes the first
        // watcher before that watcher's own startup I/O can complete.
        vi.spyOn(fs, 'realpath').mockImplementation(async (target) => String(target))
        return watchDocument(asWindow(win), at('replacement.md'))
      },
    ],
  ])('when %s while it is still starting', (_, interrupt) => {
    it('does not leave the caller waiting', async () => {
      const win = fakeWindow(1)
      const file = at('interrupted.md')
      await fs.writeFile(file, 'x\n')
      await fs.writeFile(at('replacement.md'), 'y\n')
      const { watchers, created } = trackWatchers()

      const starting = watchDocument(asWindow(win), file)
      // The watcher exists, and none of its asynchronous startup has run.
      await created
      expect(watchers[0].ready).toBe(false)

      await interrupt(win)
      await starting
    })
  })
})

it('refuses autosave after notifying the renderer of an external edit', async () => {
  const win = fakeWindow(81)
  const file = at('conflict.md')
  await fs.writeFile(file, 'accepted\n')
  const accepted = await readTextFile(file)
  await watchDocument(asWindow(win), file)
  await fs.writeFile(file, 'external content\n')
  await fs.utimes(file, new Date(), new Date(Date.now() + 2000))
  await eventually(() => {
    expect(win.received.map((e) => e.channel)).toContain('host:fileChanged')
  })
  const result = await writeTextFile(file, 'unsaved buffer\n', {
    expectedMtimeMs: accepted.mtimeMs,
    expectedText: accepted.content,
  })
  expect(result.ok).toBe(false)
  expect(await fs.readFile(file, 'utf8')).toBe('external content\n')
})
