export type ThemePreference = 'system' | 'light' | 'dark'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

/** What one window was showing, so it can be put back on next launch. */
export interface WindowSession {
  bounds: WindowBounds
  folder: string | null
  file: string | null
}

export interface Settings {
  /** Size for a window with no session of its own. */
  windowBounds: WindowBounds
  /** One entry per open window, in creation order. */
  windows: WindowSession[]
  theme: ThemePreference
  sidebar: { visible: boolean; width: number }
  toolbarVisible: boolean
  autosave: boolean
  recentFiles: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  windowBounds: { width: 1100, height: 760 },
  windows: [],
  theme: 'system',
  sidebar: { visible: true, width: 260 },
  toolbarVisible: true,
  autosave: true,
  recentFiles: [],
}

export const EMPTY_SESSION: WindowSession = {
  bounds: DEFAULT_SETTINGS.windowBounds,
  folder: null,
  file: null,
}

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends unknown[]
    ? Settings[K]
    : Settings[K] extends object
      ? Partial<Settings[K]>
      : Settings[K]
}
