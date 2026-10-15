import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

const ROOT = path.resolve(import.meta.dirname, '..')
const MAIN = path.join(ROOT, 'dist-electron', 'main.js')
const RAISE_HOOK = path.join(import.meta.dirname, 'raise-hook.cjs')

/** What main reports about one window. */
export interface WindowInfo {
  id: number
  /** The represented filename, i.e. the document the title bar shows. */
  file: string | null
  title: string
  focused: boolean
  visible: boolean
}

/**
 * A scratch area for one test: a profile directory standing in for userData,
 * and a documents directory to put markdown files in. Paths are real paths,
 * because macOS hands out /var/... for /private/var/... and only the tests
 * that are about path spelling should see the difference.
 */
export class Sandbox {
  readonly root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alethia-e2e-')))
  readonly profile = path.join(this.root, 'profile')
  readonly docs = path.join(this.root, 'docs')

  constructor() {
    fs.mkdirSync(this.profile)
    fs.mkdirSync(this.docs)
  }

  /** Writes a file under docs/ and returns its absolute path. */
  file(name: string, content = `# ${path.parse(name).name}\n\nBody of ${name}.\n`): string {
    const target = path.join(this.docs, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return target
  }

  read(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8')
  }

  /** Seeds settings.json, the way a previous session would have left it. */
  settings(value: object): void {
    fs.writeFileSync(path.join(this.profile, 'settings.json'), JSON.stringify(value))
  }

  readSettings(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(this.profile, 'settings.json'), 'utf8'))
  }

  dispose(): void {
    // A just-closed app can still be flushing settings into the profile.
    fs.rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

export async function launch(sandbox: Sandbox, args: string[] = []): Promise<ElectronApplication> {
  if (!fs.existsSync(MAIN)) throw new Error('Run `npm run build` before the end-to-end suite.')
  const env: Record<string, string> = { ALETHIA_USER_DATA_DIR: sandbox.profile }
  for (const [key, value] of Object.entries(process.env)) {
    // A dev-server URL in the environment would point the window at Vite.
    if (value !== undefined && key !== 'VITE_DEV_SERVER_URL') env[key] ??= value
  }
  return electron.launch({ args: ['-r', RAISE_HOOK, MAIN, ...args], env, cwd: ROOT })
}

const QUIT_TIMEOUT = 10_000

/**
 * Quits without leaving the next launch a stale lock. Closing a window asks
 * its renderer first, so a test that left a dirty buffer has to accept the
 * prompt it gets, which `quit` does by stubbing the dialog to Don't Save.
 *
 * An app that never finishes quitting is killed and the test fails, rather
 * than hanging until Playwright's worker teardown gives up minutes later and
 * leaving the process running under the next test.
 */
export async function quit(app: ElectronApplication): Promise<void> {
  const closing = (async () => {
    await answerSaveChanges(app, "Don't Save").catch(() => undefined)
    await app.close().catch(() => undefined)
    return 'closed' as const
  })()
  let timer: NodeJS.Timeout | undefined
  const stuck = new Promise<'stuck'>((resolve) => {
    timer = setTimeout(() => resolve('stuck'), QUIT_TIMEOUT)
  })
  const outcome = await Promise.race([closing, stuck])
  clearTimeout(timer)
  if (outcome === 'stuck') {
    app.process().kill('SIGKILL')
    throw new Error(`The app did not quit within ${QUIT_TIMEOUT / 1000}s`)
  }
}

export async function windows(app: ElectronApplication): Promise<WindowInfo[]> {
  return app.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow()
    return BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => ({
        id: win.id,
        file: win.getRepresentedFilename() || null,
        title: win.getTitle(),
        focused: win === focused,
        visible: win.isVisible(),
      }))
      .sort((a, b) => a.id - b.id)
  })
}

/** The documents on screen, one entry per window, in creation order. */
export async function openFiles(app: ElectronApplication): Promise<(string | null)[]> {
  return (await windows(app)).map((win) => win.file)
}

/** Waits until the windows settle on exactly these documents, in any order. */
export async function expectDocuments(
  app: ElectronApplication,
  files: (string | null)[],
  timeout = 10_000,
): Promise<void> {
  const sorted = (list: (string | null)[]) => [...list].map(String).sort()
  await expect.poll(async () => sorted(await openFiles(app)), { timeout }).toEqual(sorted(files))
}

/** The document in the window main raised last, i.e. the one in front. */
export async function focusedFile(app: ElectronApplication): Promise<string | null | undefined> {
  return app.evaluate(({ BrowserWindow }) => {
    const raised = (globalThis as unknown as { __alethiaRaised: number[] }).__alethiaRaised
    for (let i = raised.length - 1; i >= 0; i--) {
      const win = BrowserWindow.fromId(raised[i])
      if (win && !win.isDestroyed()) return win.getRepresentedFilename() || null
    }
    return undefined
  })
}

/**
 * Chooses a menu item the way a user does, with `page`'s window frontmost.
 * Keyboard shortcuts typed into a page never reach the native menu, so menu
 * commands are driven through the menu itself.
 */
export async function chooseMenu(app: ElectronApplication, page: Page, ...labels: string[]): Promise<void> {
  const id = await (await app.browserWindow(page)).evaluate((win) => win.id)
  await app.evaluate(({ BrowserWindow, Menu }, { id, path }) => {
    const win = BrowserWindow.fromId(id)!
    let items = Menu.getApplicationMenu()!.items
    let item: Electron.MenuItem | undefined
    for (const label of path) {
      item = items.find((candidate) => candidate.label.replace(/…$/, '') === label.replace(/…$/, ''))
      if (!item) throw new Error(`No menu item "${label}" in ${items.map((i) => i.label).join(', ')}`)
      items = item.submenu?.items ?? []
    }
    item!.click(undefined, win, win.webContents)
  }, { id, path: labels })
}

/** The page for the window showing `file`, or the only window when null. */
export async function pageFor(app: ElectronApplication, file: string | null): Promise<Page> {
  let match: Page | undefined
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          const shown = await app
            .browserWindow(page)
            .then((win) => win.evaluate((w) => w.getRepresentedFilename() || null))
            .catch(() => undefined)
          if (shown === file) {
            match = page
            return true
          }
        }
        return false
      },
      { timeout: 10_000 },
    )
    .toBe(true)
  return match!
}

/** Finder's double-click: the `open-file` event macOS delivers to a running app. */
export async function openFromFinder(app: ElectronApplication, ...files: string[]): Promise<void> {
  await app.evaluate(({ app: electronApp }, paths) => {
    for (const filePath of paths) electronApp.emit('open-file', { preventDefault() {} }, filePath)
  }, files)
}

/** The next Open dialog returns `file` instead of showing a sheet. */
export async function answerOpenDialog(app: ElectronApplication, file: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: chosen === null,
      filePaths: chosen ? [chosen] : [],
    })) as typeof dialog.showOpenDialog
  }, file)
}

/** Answers every save-changes prompt with `button`, and counts the prompts. */
export async function answerSaveChanges(
  app: ElectronApplication,
  button: 'Save' | "Don't Save" | 'Cancel',
): Promise<void> {
  await app.evaluate(({ dialog }, label) => {
    const scope = globalThis as unknown as { __prompts: string[] }
    scope.__prompts = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.find((arg) => typeof arg === 'object' && arg && 'buttons' in arg) as {
        buttons: string[]
        message: string
      }
      scope.__prompts.push(options.message)
      const response = options.buttons.indexOf(label)
      // Never fall back to another button: button 0 is Save, which writes.
      if (response < 0) throw new Error(`No "${label}" button in: ${options.buttons.join(', ')}`)
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, button)
}

export async function promptsShown(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __prompts?: string[] }).__prompts ?? [])
}

/** The editor's text as the user sees it in the buffer. */
export async function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').innerText()
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(text)
}
