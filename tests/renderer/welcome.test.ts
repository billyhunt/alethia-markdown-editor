import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const welcome = fs.readFileSync(
  path.join(import.meta.dirname, '../../src/renderer/content/welcome.md'),
  'utf8',
)

describe('the welcome tour', () => {
  it('points only at things an installed app has', () => {
    // A new user has the app, not a checkout of this repository.
    expect(welcome).not.toMatch(/public\/|repository/i)
  })
})
