/**
 * The sidebar path being dragged out of the window, if any.
 *
 * A native drag released back over the window arrives as an ordinary file
 * drop. Without this, letting go of a folder row over the sidebar would swap
 * the workspace for that folder. Matching on the path means a stale entry can
 * only ever swallow a later drop of that same item, and any drop, click or
 * return to the window clears it.
 *
 * Main may drag a resolved path (a workspace opened through a symlink), so the
 * path it reports dragging is matched too.
 */
let outgoing: string | null = null
const aliases = new Set<string>()

export function beginDragOut(filePath: string): void {
  clearDragOut()
  outgoing = filePath
}

/** Records the path main actually dragged for this sidebar row. */
export function draggedAs(filePath: string, dragged: string): void {
  if (outgoing === filePath) aliases.add(dragged)
}

export function clearDragOut(): void {
  outgoing = null
  aliases.clear()
}

/** True when this drop is the sidebar's own drag coming back. Clears it. */
export function isOwnDragOut(filePath: string): boolean {
  const own = outgoing !== null && (outgoing === filePath || aliases.has(filePath))
  clearDragOut()
  return own
}
