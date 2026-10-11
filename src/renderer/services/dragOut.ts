/**
 * The sidebar path being dragged out of the window, if any.
 *
 * A native drag released back over the window arrives as an ordinary file
 * drop. Without this, letting go of a folder row over the sidebar would swap
 * the workspace for that folder. Matching on the path means a stale entry can
 * only ever swallow a later drop of that same item, and any drop, click or
 * return to the window clears it.
 */
let outgoing: string | null = null

export function beginDragOut(filePath: string): void {
  outgoing = filePath
}

export function clearDragOut(): void {
  outgoing = null
}

/** True when this drop is the sidebar's own drag coming back. Clears it. */
export function isOwnDragOut(filePath: string): boolean {
  const own = outgoing === filePath
  outgoing = null
  return own
}
