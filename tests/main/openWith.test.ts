import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('../../src/main/paths.ts', () => ({
  grantFile: (filePath: string) => filePath,
  grantRoot: (dirPath: string) => dirPath,
  validatePath: (input: unknown) => input as string,
}))
vi.mock('../../src/main/windows.ts', () => ({
  createWindow: vi.fn(),
  isReady: vi.fn(),
  vacantWindow: vi.fn(),
  windowShowing: vi.fn(),
}))

import { enqueuePath, takePendingPaths } from '../../src/main/openWith.ts'

let root: string
let filePath: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alethia-open-with-'))
  filePath = path.join(root, 'finder.md')
  await fs.writeFile(filePath, '# Finder')
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('Finder open paths', () => {
  it('buffers a file until the first renderer is ready', async () => {
    await enqueuePath(filePath)

    expect(takePendingPaths()).toEqual([{ path: filePath, kind: 'file' }])
  })
})
