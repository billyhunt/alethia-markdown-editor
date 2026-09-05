import { nativeTheme } from 'electron'
import type { ThemePreference } from '../shared/settings.ts'

/**
 * Main owns the theme preference. Setting themeSource drives the renderer's
 * prefers-color-scheme, so the renderer needs no IPC to learn the effective
 * theme -- its CSS media query just resolves correctly.
 */
export function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme
}
