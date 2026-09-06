export type ThemePreference = 'system' | 'light' | 'dark'

export interface Settings {
  windowBounds: { x?: number; y?: number; width: number; height: number }
  lastFolder: string | null
  lastFile: string | null
  theme: ThemePreference
  sidebar: { visible: boolean; width: number }
  toolbarVisible: boolean
  recentFiles: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  windowBounds: { width: 1100, height: 760 },
  lastFolder: null,
  lastFile: null,
  theme: 'system',
  sidebar: { visible: true, width: 260 },
  toolbarVisible: true,
  recentFiles: [],
}

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends unknown[]
    ? Settings[K]
    : Settings[K] extends object
      ? Partial<Settings[K]>
      : Settings[K]
}
