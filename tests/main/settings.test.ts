import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let USER_DATA = ''
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { loadSettings, getSettings, patchSettings } = await import('../../src/main/settings.ts')

const write = (contents: unknown) =>
  fs.writeFileSync(path.join(USER_DATA, 'settings.json'), JSON.stringify(contents))

beforeEach(async () => {
  USER_DATA = await fsp.mkdtemp(path.join(os.tmpdir(), 'alethia-settings-'))
})

afterEach(async () => {
  await fsp.rm(USER_DATA, { recursive: true, force: true })
})

describe('loading', () => {
  it('falls back to defaults when nothing is stored', () => {
    const settings = loadSettings()
    expect(settings.windows).toEqual([])
    expect(settings.theme).toBe('system')
  })

  it('survives a corrupt file rather than failing to launch', () => {
    fs.writeFileSync(path.join(USER_DATA, 'settings.json'), '{ not json')
    expect(loadSettings().theme).toBe('system')
  })

  it('drops unknown keys', () => {
    write({ theme: 'dark', somethingElse: 'ignored' })
    expect(loadSettings()).not.toHaveProperty('somethingElse')
  })

  it('rejects a theme value it does not recognise', () => {
    write({ theme: 'neon' })
    expect(loadSettings().theme).toBe('system')
  })
})

describe('migration from the single-window format', () => {
  it('carries a stored lastFile and lastFolder across as one window', () => {
    // Settings written before multi-window support.
    write({
      lastFile: '/notes/today.md',
      lastFolder: '/notes',
      windowBounds: { width: 900, height: 700, x: 10, y: 20 },
    })

    const settings = loadSettings()
    expect(settings.windows).toHaveLength(1)
    expect(settings.windows[0].file).toBe('/notes/today.md')
    expect(settings.windows[0].folder).toBe('/notes')
    // The old single set of bounds becomes that window's bounds.
    expect(settings.windows[0].bounds).toMatchObject({ width: 900, height: 700 })
  })

  it('migrates a folder with no open file', () => {
    write({ lastFolder: '/notes' })
    const [session] = loadSettings().windows
    expect(session.folder).toBe('/notes')
    expect(session.file).toBeNull()
  })

  it('produces no windows when the old keys were empty', () => {
    write({ lastFile: null, lastFolder: null, theme: 'dark' })
    const settings = loadSettings()
    expect(settings.windows).toEqual([])
    expect(settings.theme).toBe('dark')
  })

  it('prefers a stored window list over the legacy keys', () => {
    write({
      lastFile: '/old.md',
      windows: [{ bounds: { width: 800, height: 600 }, folder: '/w', file: '/w/a.md' }],
    })
    const { windows } = loadSettings()
    expect(windows).toHaveLength(1)
    expect(windows[0].file).toBe('/w/a.md')
  })
})

describe('window sessions', () => {
  it('round-trips several windows', () => {
    loadSettings()
    patchSettings({
      windows: [
        { bounds: { width: 1100, height: 760 }, folder: '/a', file: '/a/one.md' },
        { bounds: { width: 900, height: 600 }, folder: '/b', file: null },
      ],
    })
    expect(getSettings().windows).toHaveLength(2)
    expect(getSettings().windows[1].file).toBeNull()
  })

  it('fills in missing fields on a partial session', () => {
    write({ windows: [{ file: '/only/a/file.md' }] })
    const [session] = loadSettings().windows
    expect(session.folder).toBeNull()
    expect(session.bounds.width).toBeGreaterThan(0)
  })

  it('caps a runaway window list', () => {
    write({ windows: Array.from({ length: 50 }, () => ({ folder: '/x', file: null })) })
    expect(loadSettings().windows.length).toBeLessThanOrEqual(20)
  })
})
