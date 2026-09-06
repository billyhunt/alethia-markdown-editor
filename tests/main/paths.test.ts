import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// paths.ts reaches for app.getPath('userData') to protect the settings
// directory; there is no Electron app object in a test run.
const USER_DATA = path.join(os.tmpdir(), 'alethia-test-userdata')
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { assertReadable, assertReadableDir, assertWritable, grantFile, grantRoot, validatePath } =
  await import('../../src/main/paths.ts')

let root: string
let granted: string
let outside: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-root-'))
  await fs.mkdir(path.join(root, 'nested'))
  granted = path.join(root, 'note.md')
  await fs.writeFile(granted, '# note')
  await fs.writeFile(path.join(root, 'nested', 'deep.md'), '# deep')

  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-other-'))
  outside = path.join(other, 'secret.md')
  await fs.writeFile(outside, '# secret')

  await fs.mkdir(USER_DATA, { recursive: true })
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(path.dirname(outside), { recursive: true, force: true })
})

describe('validatePath', () => {
  it.each([
    ['a relative path', 'notes.md'],
    ['an empty string', ''],
    ['a non-string', 42],
    ['a path containing NUL', '/tmp/a\0b.md'],
  ])('rejects %s', (_label, value) => {
    expect(() => validatePath(value)).toThrow()
  })

  it('accepts and normalises an absolute path', () => {
    expect(validatePath('/tmp/./a/../note.md')).toBe('/tmp/note.md')
  })
})

describe('the grant registry', () => {
  it('refuses a file that was never handed out', async () => {
    await expect(assertReadable(outside)).rejects.toThrow(/EPERM/)
  })

  it('allows a file once granted', async () => {
    grantFile(granted)
    await expect(assertReadable(granted)).resolves.toBe(granted)
  })

  it('grants a whole subtree when a folder is opened', async () => {
    grantRoot(root)
    await expect(assertReadable(path.join(root, 'nested', 'deep.md'))).resolves.toBeTruthy()
  })

  it('does not let a granted root cover its siblings', async () => {
    grantRoot(root)
    await expect(assertReadable(outside)).rejects.toThrow(/EPERM/)
  })

  it('refuses a traversal that climbs out of a granted root', async () => {
    grantRoot(root)
    const escape = path.join(root, '..', path.basename(path.dirname(outside)), 'secret.md')
    await expect(assertReadable(escape)).rejects.toThrow(/EPERM/)
  })

  it('refuses a symlink inside a granted root that points outside it', async () => {
    grantRoot(root)
    const link = path.join(root, 'escape.md')
    await fs.symlink(outside, link).catch(() => undefined)
    // The real path is resolved before the grant is checked.
    await expect(assertReadable(link)).rejects.toThrow(/EPERM/)
  })
})

describe('assertReadable', () => {
  it('allows plain text as well as markdown', async () => {
    const txt = path.join(root, 'plain.txt')
    await fs.writeFile(txt, 'hello')
    grantRoot(root)
    await expect(assertReadable(txt)).resolves.toBeTruthy()
  })

  it('refuses a file type the app has no business reading', async () => {
    const sh = path.join(root, 'run.sh')
    await fs.writeFile(sh, '#!/bin/sh')
    grantRoot(root)
    await expect(assertReadable(sh)).rejects.toThrow(/unsupported file type/)
  })
})

describe('assertWritable', () => {
  it('allows a granted markdown file', async () => {
    grantRoot(root)
    await expect(assertWritable(granted)).resolves.toBe(granted)
  })

  it('refuses writing plain text, which reads fine but is not a save target', async () => {
    const txt = path.join(root, 'plain.txt')
    grantRoot(root)
    await expect(assertWritable(txt)).rejects.toThrow(/non-markdown/)
  })

  it('refuses writing an executable even inside a granted root', async () => {
    grantRoot(root)
    await expect(assertWritable(path.join(root, 'evil.sh'))).rejects.toThrow(/non-markdown/)
  })

  it('refuses writing into the app settings directory', async () => {
    // Granting it explicitly proves the userData guard is what refuses, not
    // a missing grant.
    grantRoot(USER_DATA)
    await expect(assertWritable(path.join(USER_DATA, 'settings.md'))).rejects.toThrow(/userData/)
  })

  it('allows a file that does not exist yet, for Save As', async () => {
    grantRoot(root)
    await expect(assertWritable(path.join(root, 'brand-new.md'))).resolves.toBeTruthy()
  })
})

describe('assertReadableDir', () => {
  it('accepts a granted root and refuses an ungranted directory', async () => {
    grantRoot(root)
    await expect(assertReadableDir(root)).resolves.toBe(root)
    await expect(assertReadableDir(path.dirname(outside))).rejects.toThrow(/EPERM/)
  })
})
