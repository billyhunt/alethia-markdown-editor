import { describe, expect, it } from 'vitest'
import { REPO_URL } from '../../src/main/menu.ts'

describe('Application Menu Help item', () => {
  it('points Alethia on GitHub to the Alethia repository instead of generic github.com', () => {
    expect(REPO_URL).toBe('https://github.com/billyhunt/alethia-markdown-editor')
  })
})
