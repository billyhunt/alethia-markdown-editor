import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
  type WindowSession,
} from '../shared/settings.ts'

let cache: Settings = { ...DEFAULT_SETTINGS }
let saveTimer: NodeJS.Timeout | null = null

const settingsPath = (): string => path.join(app.getPath('userData'), 'settings.json')

const asSession = (raw: unknown, fallbackBounds: Settings['windowBounds']): WindowSession => {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<WindowSession>
  return {
    bounds: { ...fallbackBounds, ...(input.bounds ?? {}) },
    folder: typeof input.folder === 'string' ? input.folder : null,
    file: typeof input.file === 'string' ? input.file : null,
  }
}

/** Merges stored values over the defaults, dropping unknown keys. */
function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<Settings> & { lastFile?: unknown; lastFolder?: unknown }
  const windowBounds = { ...DEFAULT_SETTINGS.windowBounds, ...(input.windowBounds ?? {}) }

  // Settings written before multi-window support held a single lastFile and
  // lastFolder; carry them across as one window rather than dropping the
  // user's session on upgrade.
  const windows = Array.isArray(input.windows)
    ? input.windows.slice(0, 20).map((entry) => asSession(entry, windowBounds))
    : typeof input.lastFile === 'string' || typeof input.lastFolder === 'string'
      ? [
          {
            bounds: windowBounds,
            folder: typeof input.lastFolder === 'string' ? input.lastFolder : null,
            file: typeof input.lastFile === 'string' ? input.lastFile : null,
          },
        ]
      : []

  return {
    windowBounds,
    windows,
    theme:
      input.theme === 'light' || input.theme === 'dark' || input.theme === 'system'
        ? input.theme
        : DEFAULT_SETTINGS.theme,
    sidebar: { ...DEFAULT_SETTINGS.sidebar, ...(input.sidebar ?? {}) },
    toolbarVisible:
      typeof input.toolbarVisible === 'boolean'
        ? input.toolbarVisible
        : DEFAULT_SETTINGS.toolbarVisible,
    autosave: typeof input.autosave === 'boolean' ? input.autosave : DEFAULT_SETTINGS.autosave,
    recentFiles: Array.isArray(input.recentFiles)
      ? input.recentFiles.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
      : [],
  }
}

export function loadSettings(): Settings {
  try {
    cache = coerce(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
  } catch {
    // Missing or corrupt settings should never stop the app launching.
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

export const getSettings = (): Settings => cache

export function patchSettings(patch: SettingsPatch): Settings {
  cache = {
    ...cache,
    ...patch,
    windowBounds: { ...cache.windowBounds, ...(patch.windowBounds ?? {}) },
    sidebar: { ...cache.sidebar, ...(patch.sidebar ?? {}) },
  }
  scheduleSave()
  return cache
}

const SIDEBAR_WIDTH_RANGE = { min: 120, max: 800 } as const

/**
 * The renderer may change exactly what it owns: sidebar layout, toolbar
 * visibility and autosave. Theme, window bounds, recents and window sessions
 * are written by main only (menu, window lifecycle, recents handlers), so a
 * compromised renderer cannot poison what feeds createWindow or session
 * restore on the next launch. Values are validated and only known keys are
 * copied; anything else is refused.
 */
export function patchUiSettings(patch: Record<string, unknown>): Settings {
  const allowed = new Set(['sidebar', 'toolbarVisible', 'autosave'])
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`EPERM: setting ${key} is main-owned`)

  const clean: SettingsPatch = {}
  if ('toolbarVisible' in patch) {
    if (typeof patch.toolbarVisible !== 'boolean') throw new TypeError('toolbarVisible must be a boolean')
    clean.toolbarVisible = patch.toolbarVisible
  }
  if ('autosave' in patch) {
    if (typeof patch.autosave !== 'boolean') throw new TypeError('autosave must be a boolean')
    clean.autosave = patch.autosave
  }
  if ('sidebar' in patch) {
    const raw = patch.sidebar
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TypeError('sidebar must be an object')
    const sidebar: Partial<Settings['sidebar']> = {}
    const { visible, width } = raw as Record<string, unknown>
    if (visible !== undefined) {
      if (typeof visible !== 'boolean') throw new TypeError('sidebar.visible must be a boolean')
      sidebar.visible = visible
    }
    if (width !== undefined) {
      if (typeof width !== 'number' || !Number.isFinite(width)) throw new TypeError('sidebar.width must be a finite number')
      sidebar.width = Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, Math.round(width)))
    }
    clean.sidebar = sidebar
  }
  return patchSettings(clean)
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveSettings()
  }, 300)
}

/** Written temp-then-rename so a crash mid-write cannot truncate settings. */
async function saveSettings(): Promise<void> {
  const target = settingsPath()
  const tmp = `${target}.tmp`
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8')
    await fsp.rename(tmp, target)
  } catch {
    // Settings are a convenience; never surface a failure to persist them.
  }
}

/** Called on will-quit, where async work would not finish in time. */
export function flushSettings(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}
