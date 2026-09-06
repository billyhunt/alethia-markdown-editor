import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'alethia-le-userdata')
vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { grantRoot } = await import('../../src/main/paths.ts')
const { readTextFile, writeTextFile } = await import('../../src/main/files.ts')

let root: string
const at = (name: string) => path.join(root, name)

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-le-'))
  grantRoot(root)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const CRLF = '\r\n'

describe('reading', () => {
  it('reports CRLF and hands the editor LF', async () => {
    await fs.writeFile(at('crlf.md'), `# Title${CRLF}${CRLF}Body.${CRLF}`)
    const result = await readTextFile(at('crlf.md'))
    expect(result.lineEnding).toBe(CRLF)
    expect(result.content).toBe('# Title\n\nBody.\n')
    expect(result.content).not.toContain('\r')
  })

  it('reports LF for a unix file', async () => {
    await fs.writeFile(at('lf.md'), '# Title\n\nBody.\n')
    expect((await readTextFile(at('lf.md'))).lineEnding).toBe('\n')
  })

  it('picks the dominant ending in a mixed file', async () => {
    await fs.writeFile(at('mixed.md'), `a${CRLF}b${CRLF}c\nd${CRLF}`)
    expect((await readTextFile(at('mixed.md'))).lineEnding).toBe(CRLF)

    await fs.writeFile(at('mostly-lf.md'), `a\nb\nc${CRLF}d\n`)
    expect((await readTextFile(at('mostly-lf.md'))).lineEnding).toBe('\n')
  })

  it('treats a file with no line breaks as LF', async () => {
    await fs.writeFile(at('one-line.md'), '# Just a title')
    expect((await readTextFile(at('one-line.md'))).lineEnding).toBe('\n')
  })

  it('strips a UTF-8 BOM', async () => {
    await fs.writeFile(at('bom.md'), '﻿# Title\n')
    expect((await readTextFile(at('bom.md'))).content).toBe('# Title\n')
  })
})

describe('writing', () => {
  it('restores CRLF so opening and saving does not rewrite the file', async () => {
    const original = `# Title${CRLF}${CRLF}Body.${CRLF}`
    await fs.writeFile(at('roundtrip.md'), original)

    const read = await readTextFile(at('roundtrip.md'))
    const write = await writeTextFile(at('roundtrip.md'), read.content, {
      lineEnding: read.lineEnding,
    })

    expect(write.ok).toBe(true)
    expect(await fs.readFile(at('roundtrip.md'), 'utf8')).toBe(original)
  })

  it('writes LF when no ending is supplied', async () => {
    await writeTextFile(at('new.md'), 'a\nb\n', {})
    expect(await fs.readFile(at('new.md'), 'utf8')).toBe('a\nb\n')
  })

  it('does not double up carriage returns on a second save', async () => {
    await fs.writeFile(at('twice.md'), `a${CRLF}b${CRLF}`)
    const first = await readTextFile(at('twice.md'))
    await writeTextFile(at('twice.md'), first.content, { lineEnding: first.lineEnding })
    const second = await readTextFile(at('twice.md'))
    await writeTextFile(at('twice.md'), second.content, { lineEnding: second.lineEnding })

    const final = await fs.readFile(at('twice.md'), 'utf8')
    expect(final).toBe(`a${CRLF}b${CRLF}`)
    expect(final).not.toContain('\r\r')
  })

  it('preserves content that legitimately has no trailing newline', async () => {
    await fs.writeFile(at('bare.md'), '# No trailing newline')
    const read = await readTextFile(at('bare.md'))
    await writeTextFile(at('bare.md'), read.content, { lineEnding: read.lineEnding })
    expect(await fs.readFile(at('bare.md'), 'utf8')).toBe('# No trailing newline')
  })
})
