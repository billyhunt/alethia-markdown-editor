import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setImmediate as nextTick } from 'node:timers/promises'
import type { WindowSession } from '../../src/shared/settings.ts'

/**
 * Routing runs for real here -- openWith, windows and the IPC handlers -- over
 * a stand-in for Electron's BrowserWindow. A window starts hidden and loading;
 * `paint` is its ready-to-show, and `rendererReady` is its renderer starting.
 */

type Listener = (...args: unknown[]) => void

const electron = vi.hoisted(() => {
  class FakeWindow {
    static all: FakeWindow[] = []
    static raised: number[] = []
    static loaded: string[] = []
    static nextId = 1
    static getAllWindows = (): FakeWindow[] => FakeWindow.all.filter((win) => !win.destroyed)
    static getFocusedWindow = (): FakeWindow | null => null
    static fromWebContents = (contents: unknown): FakeWindow | null =>
      FakeWindow.all.find((win) => win.webContents === contents) ?? null

    id = FakeWindow.nextId++
    visible = false
    minimized = false
    destroyed = false
    listeners = new Map<string, Listener[]>()
    sent: { channel: string; payload: unknown }[] = []
    webContents = {
      send: (channel: string, payload: unknown) => this.sent.push({ channel, payload }),
      on: () => undefined,
    }

    constructor() {
      FakeWindow.all.push(this)
    }
    on(name: string, listener: Listener): this {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
      return this
    }
    once(name: string, listener: Listener): this {
      const wrapped: Listener = (...args) => {
        this.listeners.set(name, (this.listeners.get(name) ?? []).filter((l) => l !== wrapped))
        listener(...args)
      }
      return this.on(name, wrapped)
    }
    emit(name: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args)
    }
    show(): void {
      this.visible = true
      FakeWindow.raised.push(this.id)
      this.emit('show')
    }
    focus(): void {
      FakeWindow.raised.push(this.id)
    }
    minimize(): void {
      this.minimized = true
    }
    restore(): void {
      this.minimized = false
    }
    setRepresentedFilename(): void {}
    setDocumentEdited(): void {}
    setTitle(): void {}
    // As on macOS: a minimized window does not count as visible.
    isVisible = (): boolean => this.visible && !this.minimized
    isMinimized = (): boolean => this.minimized
    isDestroyed = (): boolean => this.destroyed
    isFullScreen = (): boolean => false
    getNormalBounds = () => ({ x: 0, y: 0, width: 900, height: 600 })
    loadFile = (): Promise<void> => {
      FakeWindow.loaded.push('file')
      return Promise.resolve()
    }
    loadURL = (url: string): Promise<void> => {
      FakeWindow.loaded.push(url)
      return Promise.resolve()
    }
  }

  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const settings = { windows: [] as WindowSession[] }
  const app = { isPackaged: true, getVersion: () => '0.0.0', getPath: () => '/tmp' }
  return { FakeWindow, handlers, settings, app }
})

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.FakeWindow,
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    on: () => undefined,
  },
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 4000, height: 4000 } }) },
  shell: {},
}))
vi.mock('../../src/main/settings.ts', () => ({
  getSettings: () => electron.settings,
  patchSettings: (patch: object) => Object.assign(electron.settings, patch),
}))
vi.mock('../../src/main/security.ts', () => ({ hardenWebContents: () => undefined }))
vi.mock('../../src/main/watcher.ts', () => ({
  closeWatchersFor: async () => undefined,
  watchDocument: async () => undefined,
  unwatchDocument: async () => undefined,
  watchFolder: async () => undefined,
  unwatchFolder: async () => undefined,
}))
// Loaded by the IPC module but not part of routing.
vi.mock('../../src/main/files.ts', () => ({}))
vi.mock('../../src/main/folder.ts', () => ({}))
vi.mock('../../src/main/dialogs.ts', () => ({}))
vi.mock('../../src/main/recents.ts', () => ({}))
vi.mock('../../src/main/fileMenu.ts', () => ({}))
vi.mock('../../src/main/printing.ts', () => ({}))
vi.mock('../../src/main/versions.ts', () => ({}))

type FakeWindow = InstanceType<typeof electron.FakeWindow>
type OpenWith = typeof import('../../src/main/openWith.ts')
type Windows = typeof import('../../src/main/windows.ts')
type Ipc = typeof import('../../src/shared/ipc.ts')

let openWith: OpenWith
let windows: Windows
let IPC: Ipc['IPC']

let root: string
const file = (name: string): string => path.join(root, name)

beforeAll(async () => {
  // Real paths: on macOS the temp directory is a /var alias of /private/var.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-routing-')))
  for (const name of ['one.md', 'two.md', 'three.md', 'old.md']) {
    await fs.writeFile(file(name), `# ${name}`)
  }
  await fs.symlink(root, file('alias'))
  await fs.symlink(file('one.md'), file('link.md'))
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  // Fresh module state (the started flag, window states, path grants) per test.
  vi.resetModules()
  electron.FakeWindow.all = []
  electron.FakeWindow.loaded = []
  electron.app.isPackaged = true
  electron.FakeWindow.raised = []
  electron.FakeWindow.nextId = 1
  electron.handlers.clear()
  electron.settings.windows = []
  openWith = await import('../../src/main/openWith.ts')
  windows = await import('../../src/main/windows.ts')
  ;({ IPC } = await import('../../src/shared/ipc.ts'))
  ;(await import('../../src/main/ipc.ts')).registerIpcHandlers()
})

const all = (): FakeWindow[] => electron.FakeWindow.getAllWindows()
const paint = (win: FakeWindow): void => win.emit('ready-to-show')
const invoke = (win: FakeWindow, channel: string, ...args: unknown[]) =>
  electron.handlers.get(channel)!({ sender: win.webContents }, ...args)

/** The renderer starting: returns the opens that were waiting for it. */
const rendererReady = async (win: FakeWindow): Promise<string[]> => {
  const ready = (await invoke(win, IPC.appRendererReady)) as { pendingPaths: { path: string }[] }
  return ready.pendingPaths.map((entry) => entry.path)
}
/** The renderer opening a file and telling main about it. */
const showsDocument = (win: FakeWindow, filePath: string) => invoke(win, IPC.docWatch, filePath)
const sentOpens = (win: FakeWindow): unknown[] =>
  win.sent.filter((m) => m.channel === IPC.hostOpenPath).map((m) => (m.payload as { path: string }).path)
const session = (overrides: Partial<WindowSession>): WindowSession => ({
  bounds: { width: 900, height: 600 },
  folder: null,
  file: null,
  ...overrides,
})
const lastRaised = (): number | undefined => electron.FakeWindow.raised.at(-1)

describe('opening files at launch', () => {
  it('gives each launched file a window of its own, delivered only to that window', async () => {
    const files = [file('one.md'), file('two.md'), file('three.md')]
    for (const f of files) await openWith.enqueuePath(f)
    openWith.startUp()

    expect(all()).toHaveLength(3)
    for (const [i, win] of all().entries()) expect(await rendererReady(win)).toEqual([files[i]])
  })

  it('leaves restored documents where they are and opens the launched file beside them', async () => {
    electron.settings.windows = [session({ file: file('old.md') })]
    await openWith.enqueuePath(file('one.md'))
    openWith.startUp()

    const [restored, launched] = all()
    expect(await rendererReady(restored)).toEqual([])
    expect(await rendererReady(launched)).toEqual([file('one.md')])
  })

  it('does not hide a restored folder behind a launched file', async () => {
    electron.settings.windows = [session({ folder: root })]
    await openWith.enqueuePath(file('one.md'))
    openWith.startUp()

    const [restored, launched] = all()
    expect(all()).toHaveLength(2)
    expect(await rendererReady(restored)).toEqual([])
    expect(await rendererReady(launched)).toEqual([file('one.md')])
  })

  it('puts the launched file in front once every restored window has shown', async () => {
    electron.settings.windows = [session({ file: file('old.md') }), session({ file: file('two.md') })]
    await openWith.enqueuePath(file('one.md'))
    openWith.startUp()
    const [first, second, launched] = all()

    // Restored windows can finish painting after the launched one.
    paint(launched)
    paint(first)
    expect(lastRaised()).toBe(first.id)
    paint(second)
    await new Promise((resolve) => setImmediate(resolve))

    expect(lastRaised()).toBe(launched.id)
  })

  it('keeps the launched file in front when a restored window paints after its fallback', async () => {
    vi.useFakeTimers()
    try {
      electron.settings.windows = [session({ file: file('old.md') }), session({ file: file('two.md') })]
      await openWith.enqueuePath(file('one.md'))
      openWith.startUp()
      const [first, second, launched] = all()

      paint(launched)
      vi.advanceTimersByTime(5000) // both restored windows miss the fallback
      expect(lastRaised()).toBe(launched.id)
      paint(first)
      vi.runAllTicks()
      await vi.runAllTimersAsync()
      expect(lastRaised()).toBe(launched.id)
      paint(second)
      await vi.runAllTimersAsync()
      expect(lastRaised()).toBe(launched.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens no stray empty window when the only thing to show is the launched file', async () => {
    await openWith.enqueuePath(file('one.md'))
    openWith.startUp()

    expect(all()).toHaveLength(1)
  })

  it('restores a document saved in two windows into only one of them', () => {
    electron.settings.windows = [session({ file: file('one.md') }), session({ file: file('one.md') })]
    openWith.startUp()

    expect(all().map((win) => windows.windowShowing(file('one.md')) === win)).toEqual([true, false])
  })

  it('ignores a path it cannot open', async () => {
    expect(await openWith.enqueuePath(file('missing.md'))).toBe(false)
    expect(await openWith.enqueuePath('relative.md')).toBe(false)
  })
})

describe('opening files while running', () => {
  beforeEach(() => {
    openWith.startUp() // one empty window, still loading
  })

  it('sends rapid opens to separate windows, even before the first has loaded', async () => {
    const [empty] = all()
    for (const f of [file('one.md'), file('two.md'), file('three.md')]) await openWith.enqueuePath(f)

    expect(all()).toHaveLength(3)
    expect(await rendererReady(empty)).toEqual([file('one.md')])
    expect(await rendererReady(all()[1])).toEqual([file('two.md')])
  })

  it('sends straight to a renderer that is already listening', async () => {
    const [empty] = all()
    await rendererReady(empty)
    await openWith.enqueuePath(file('one.md'))

    expect(sentOpens(empty)).toEqual([file('one.md')])
  })

  it('treats a file on its way to a window as already open there', async () => {
    await openWith.enqueuePath(file('one.md'))
    await openWith.enqueuePath(file('one.md'))

    expect(all()).toHaveLength(1)
  })

  it('brings forward the window showing a file reached through a symlink', async () => {
    const [win] = all()
    await rendererReady(win)
    paint(win)
    await openWith.enqueuePath(file('one.md'))
    await showsDocument(win, file('one.md'))
    electron.FakeWindow.raised = []

    await openWith.enqueuePath(path.join(root, 'alias', 'one.md'))

    expect(all()).toHaveLength(1)
    expect(lastRaised()).toBe(win.id)
  })

  it('brings back a minimized window showing the file', async () => {
    const [win] = all()
    await rendererReady(win)
    paint(win)
    await openWith.enqueuePath(file('one.md'))
    await showsDocument(win, file('one.md'))
    win.minimize()
    electron.FakeWindow.raised = []

    await openWith.enqueuePath(file('one.md'))

    expect(win.minimized).toBe(false)
    expect(lastRaised()).toBe(win.id)
  })

  it('reserves a window for a folder on its way, so a second one gets its own', async () => {
    const [empty] = all()
    await rendererReady(empty)
    await openWith.enqueuePath(root)
    await openWith.enqueuePath(file('one.md'))

    expect(sentOpens(empty)).toEqual([root])
    expect(all()).toHaveLength(2)
  })

  it('never routes into a window with unsaved text', async () => {
    const [draft] = all()
    await rendererReady(draft)
    await invoke(draft, IPC.windowSetDocument, { filePath: null, edited: true })

    await openWith.enqueuePath(file('one.md'))

    expect(sentOpens(draft)).toEqual([])
    expect(all()).toHaveLength(2)
  })

  it('opens a new window rather than replacing an open folder', async () => {
    const [win] = all()
    await rendererReady(win)
    windows.noteFolder(win as never, root)

    await openWith.enqueuePath(file('one.md'))

    expect(all()).toHaveLength(2)
  })

  it('does not focus a window before it has painted', async () => {
    await openWith.enqueuePath(file('one.md'))
    await openWith.enqueuePath(file('one.md'))

    expect(electron.FakeWindow.raised).toEqual([])
  })
})

describe('opens from inside a window', () => {
  let first: FakeWindow
  let second: FakeWindow

  beforeEach(async () => {
    await openWith.enqueuePath(file('one.md'))
    await openWith.enqueuePath(file('two.md'))
    openWith.startUp()
    ;[first, second] = all()
    for (const win of all()) {
      paint(win)
      await rendererReady(win)
    }
    await showsDocument(first, file('one.md'))
    await showsDocument(second, file('two.md'))
    electron.FakeWindow.raised = []
  })

  it('reveals the other window showing the file', async () => {
    expect(await invoke(second, IPC.windowRevealDocument, file('one.md'))).toBe(true)
    expect(lastRaised()).toBe(first.id)
  })

  it('does not count the asking window as the other one', async () => {
    expect(await invoke(second, IPC.windowRevealDocument, file('two.md'))).toBe(false)
  })

  it('answers no, rather than failing, for a path it may not read', async () => {
    expect(await invoke(second, IPC.windowRevealDocument, '/etc/hosts')).toBe(false)
    expect(await invoke(second, IPC.windowRevealDocument, 'relative.md')).toBe(false)
  })
})

describe('handing a routed file back', () => {
  let draft: FakeWindow

  beforeEach(async () => {
    openWith.startUp()
    ;[draft] = all()
    await rendererReady(draft)
    // Main routes the file here before hearing about the user's typing.
    await openWith.enqueuePath(file('one.md'))
  })

  it('opens the file in another window and keeps this one off-limits', async () => {
    await invoke(draft, IPC.windowRerouteOpen, file('one.md'))

    expect(all()).toHaveLength(2)
    expect(windows.windowShowing(file('one.md'))).toBe(all()[1])
    expect(windows.vacantWindow()).toBeNull()
  })

  it('refuses a file that was not routed here, and still releases the reservation', async () => {
    await expect(invoke(draft, IPC.windowRerouteOpen, file('two.md'))).rejects.toThrow('EPERM')

    expect(all()).toHaveLength(1)
    expect(windows.windowShowing(file('one.md'))).toBeNull()
  })

  it('releases the reservation when the renderer settles the open', async () => {
    await invoke(draft, IPC.windowSettleOpen)
    expect(windows.windowShowing(file('one.md'))).toBeNull()
  })
})

describe('closing', () => {
  it('closes a window whose renderer never started, instead of waiting on it', () => {
    openWith.startUp()
    const [win] = all()
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('asks a running renderer before closing', async () => {
    openWith.startUp()
    const [win] = all()
    await rendererReady(win)
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.sent.map((m) => m.channel)).toContain(IPC.hostCloseRequested)
  })
})

describe('one editor per document', () => {
  let first: FakeWindow
  let second: FakeWindow

  beforeEach(async () => {
    electron.settings.windows = [session({}), session({})]
    // Lets the windows read the files below without routing anything to them.
    ;(await import('../../src/main/paths.ts')).grantRoot(root)
    openWith.startUp()
    ;[first, second] = all()
    for (const win of all()) {
      paint(win)
      await rendererReady(win)
    }
    electron.FakeWindow.raised = []
  })

  it('lets only one of two windows asked at once open the file', async () => {
    const answers = await Promise.all([
      invoke(first, IPC.windowRevealDocument, file('one.md')),
      invoke(second, IPC.windowRevealDocument, file('one.md')),
    ])

    // Exactly one is told to open it; the other is sent to that window.
    expect(answers.filter((answer) => answer === false)).toHaveLength(1)
    expect(answers.filter((answer) => answer === true)).toHaveLength(1)
    const opener = answers[0] === false ? first : second
    const other = opener === first ? second : first
    expect(lastRaised()).toBe(opener.id)
    expect(windows.windowShowing(file('one.md'))).toBe(opener)
    // And a launch request for it goes to the claimant too.
    await openWith.enqueuePath(file('one.md'))
    expect(lastRaised()).toBe(opener.id)
    expect(sentOpens(other)).toEqual([])
  })

  it('frees the file when the open is released without ever showing it', async () => {
    expect(await invoke(first, IPC.windowRevealDocument, file('one.md'))).toBe(false)
    expect(await invoke(second, IPC.windowRevealDocument, file('one.md'))).toBe(true)

    // The first window's open failed, or was cancelled at the save prompt.
    await invoke(first, IPC.windowReleaseDocument, file('one.md'))

    expect(windows.windowShowing(file('one.md'))).toBeNull()
    expect(await invoke(second, IPC.windowRevealDocument, file('one.md'))).toBe(false)
  })

  it('keeps pointing at the window once it shows the file, after the claim is released', async () => {
    await invoke(first, IPC.windowRevealDocument, file('one.md'))
    await showsDocument(first, file('one.md'))
    await invoke(first, IPC.windowReleaseDocument, file('one.md'))

    expect(await invoke(second, IPC.windowRevealDocument, file('one.md'))).toBe(true)
    expect(lastRaised()).toBe(first.id)
  })

  it('does not hand a window mid-open a launched file', async () => {
    await invoke(first, IPC.windowRevealDocument, file('one.md'))
    await openWith.enqueuePath(file('three.md'))

    expect(sentOpens(first)).toEqual([])
    expect(sentOpens(second)).toEqual([file('three.md')])
  })

  it('brings forward the window showing a file reached through a symlink to it', async () => {
    await showsDocument(first, file('one.md'))
    electron.FakeWindow.raised = []

    await openWith.enqueuePath(file('link.md'))

    expect(all()).toHaveLength(2)
    expect(lastRaised()).toBe(first.id)
    expect(sentOpens(second)).toEqual([])
  })
})

describe('restored sessions are matched by real path', () => {
  it('opens a launched file in the window that restored it through an alias', async () => {
    electron.settings.windows = [session({ file: path.join(root, 'alias', 'old.md') })]
    await openWith.enqueuePath(file('old.md'))
    openWith.startUp()

    expect(all()).toHaveLength(1)
    expect(windows.windowShowing(file('old.md'))).toBe(all()[0])
    expect(await rendererReady(all()[0])).toEqual([])
  })

  it('restores a document saved under two spellings into only one window', async () => {
    electron.settings.windows = [
      session({ file: path.join(root, 'alias', 'one.md') }),
      session({ file: file('one.md') }),
    ]
    openWith.startUp()
    const [first, second] = all()

    expect(windows.windowShowing(file('one.md'))).toBe(first)
    const restored = async (win: FakeWindow) =>
      ((await invoke(win, IPC.appRendererReady)) as { session: WindowSession }).session.file
    expect(await restored(first)).toBe(file('one.md'))
    expect(await restored(second)).toBeNull()
  })
})

describe('window order', () => {
  it('keeps the newest of several rapid opens in front whatever order they paint in', async () => {
    openWith.startUp()
    const requests = [file('one.md'), file('two.md'), file('three.md')]
    for (const f of requests) await openWith.enqueuePath(f)
    const [oldest, middle, newest] = all()

    paint(newest)
    paint(middle)
    paint(oldest)
    await nextTick()

    expect(lastRaised()).toBe(newest.id)
  })

  it('puts a re-opened file in front of windows that are still painting', async () => {
    openWith.startUp()
    const [shown] = all()
    await rendererReady(shown)
    paint(shown)
    await openWith.enqueuePath(file('one.md'))
    await showsDocument(shown, file('one.md'))
    await openWith.enqueuePath(file('two.md')) // a new window, still painting
    const painting = all()[1]
    await openWith.enqueuePath(file('one.md')) // ...but the user asked for this one last

    paint(painting)
    await nextTick()

    expect(lastRaised()).toBe(shown.id)
  })

  it('puts a launched folder in front of restored windows, as it does a file', async () => {
    electron.settings.windows = [session({ folder: root })]
    await openWith.enqueuePath(root)
    openWith.startUp()
    const [restored, folder] = all()

    paint(folder)
    paint(restored)
    await nextTick()

    expect(lastRaised()).toBe(folder.id)
  })

  it('returns the window the open went to', async () => {
    openWith.startUp()
    const [empty] = all()
    await rendererReady(empty)

    expect(openWith.route({ path: file('one.md'), kind: 'file' })).toBe(empty)
    expect(openWith.route({ path: file('one.md'), kind: 'file' })).toBe(empty)
    expect(openWith.route({ path: file('two.md'), kind: 'file' })).toBe(all()[1])
  })
})

describe('a launched file and a restored workspace', () => {
  it('does not leave the workspace stored against the launched file', async () => {
    electron.settings.windows = [session({ folder: root })]
    await openWith.enqueuePath(file('one.md'))
    openWith.startUp()
    const [restored, launched] = all()
    await rendererReady(restored)
    await rendererReady(launched)
    await showsDocument(launched, file('one.md'))

    windows.persistSessions()

    expect(electron.settings.windows.map((w) => [w.folder, w.file])).toEqual([
      [root, null],
      [null, file('one.md')],
    ])
  })
})

describe('loading the app', () => {
  const DEV_URL = 'http://localhost:5173'

  const loadsWith = async (isPackaged: boolean): Promise<string[]> => {
    process.env.VITE_DEV_SERVER_URL = DEV_URL
    try {
      electron.app.isPackaged = isPackaged
      vi.resetModules()
      ;(await import('../../src/main/windows.ts')).createWindow()
      return electron.FakeWindow.loaded
    } finally {
      delete process.env.VITE_DEV_SERVER_URL
    }
  }

  it('ignores a dev server in the environment of a packaged app', async () => {
    expect(await loadsWith(true)).toEqual(['file'])
  })

  it('uses the dev server when running unpackaged', async () => {
    expect(await loadsWith(false)).toEqual([DEV_URL])
  })
})

describe('passing a routed file on', () => {
  it('refuses a file when none was routed to the window', async () => {
    openWith.startUp()
    const [win] = all()
    await rendererReady(win)
    // Grants the folder so only the routing check can refuse.
    ;(await import('../../src/main/paths.ts')).grantRoot(root)

    await expect(invoke(win, IPC.windowRerouteOpen, file('one.md'))).rejects.toThrow(
      'not the file routed to this window',
    )
    expect(all()).toHaveLength(1)
  })

  it('refuses a different file than the one routed, even one it may read', async () => {
    openWith.startUp()
    const [win] = all()
    await rendererReady(win)
    await openWith.enqueuePath(file('one.md'))

    await expect(invoke(win, IPC.windowRerouteOpen, file('two.md'))).rejects.toThrow(
      'not the file routed to this window',
    )
    expect(all()).toHaveLength(1)
  })
})
