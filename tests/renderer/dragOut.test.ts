import { beforeEach, describe, expect, it } from 'vitest'
import { beginDragOut, clearDragOut, draggedAs, isOwnDragOut } from '../../src/renderer/services/dragOut.ts'

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

  it('matches the resolved path main dragged instead', () => {
    beginDragOut('/var/notes/plans')
    draggedAs('/var/notes/plans', '/private/var/notes/plans')
    expect(isOwnDragOut('/private/var/notes/plans')).toBe(true)
    expect(isOwnDragOut('/private/var/notes/plans')).toBe(false)
  })

  it('ignores a late reply for a drag already over', () => {
    beginDragOut('/notes/plans')
    clearDragOut()
    draggedAs('/notes/plans', '/real/notes/plans')
    expect(isOwnDragOut('/real/notes/plans')).toBe(false)
  })
})
