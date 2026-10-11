import { beforeEach, describe, expect, it } from 'vitest'
import { beginDragOut, clearDragOut, isOwnDragOut } from '../../src/renderer/services/dragOut.ts'

beforeEach(() => clearDragOut())

describe('recognising the sidebar drag coming back', () => {
  it('matches the dropped path once', () => {
    beginDragOut('/notes/plans')
    expect(isOwnDragOut('/notes/plans')).toBe(true)
    // A later, real drop of the same folder is the user's.
    expect(isOwnDragOut('/notes/plans')).toBe(false)
  })

  it('lets any other drop through, and forgets the drag', () => {
    beginDragOut('/notes/plans')
    expect(isOwnDragOut('/Users/me/Desktop/other.md')).toBe(false)
    expect(isOwnDragOut('/notes/plans')).toBe(false)
  })

  it('forgets the drag on the next click', () => {
    beginDragOut('/notes/plans')
    clearDragOut()
    expect(isOwnDragOut('/notes/plans')).toBe(false)
  })
})
