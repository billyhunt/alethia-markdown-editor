/**
 * Naming a document after what it says.
 *
 * A new buffer is saved automatically under its own title rather than through
 * a Save As dialog, so the title has to survive becoming a file name: no
 * separators, no leading dot, nothing long enough to be unreadable in a
 * sidebar.
 *
 * Pure and shared, so main and renderer agree on the name and the rules are
 * testable without a window.
 */
import { MARKDOWN_EXTENSIONS } from './markdown.ts'

/** YAML front matter is metadata, not the first line of the document. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?(?:\r?\n---|\r?\n\.\.\.)\r?\n?/

/** Path separators, macOS's colon, and anything unprintable. */
const ILLEGAL = /[\\/:*?"<>|\p{Cc}]/gu

const HORIZONTAL_RULE = /^(?:-{3,}|_{3,}|\*{3,})$/
const FENCE = /^(?:```|~~~)/
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/
const TASK_MARKER = /^\[[ xX]\]\s+/

/** Long enough to stay recognisable, short enough to read in a file list. */
const MAX_NAME_LENGTH = 60

/** Strips the markdown around a line so only its words remain. */
function plainText(line: string): string {
  return line
    .replace(/^#{1,6}(?:\s+|$)/, '')
    .replace(/^>\s?/, '')
    .replace(LIST_MARKER, '')
    .replace(TASK_MARKER, '')
    // Links and images keep their visible text, not their target.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The document's title: its first heading, or failing that its first line of
 * prose. Null when there is nothing to go on yet.
 */
export function documentTitle(text: string): string | null {
  const body = text.replace(FRONT_MATTER, '')
  let inFence = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    // Code is not a title, so a fenced block is skipped whole rather than
    // just at its fences.
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || !line || HORIZONTAL_RULE.test(line)) continue
    const title = plainText(line)
    if (title) return title
  }
  return null
}

/**
 * Turns a title into a markdown file name. Null when nothing usable survives
 * sanitising, e.g. a document whose first line is only punctuation.
 */
export function fileNameForTitle(title: string): string | null {
  let name = title
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot would hide the file; a leading dash reads as a flag.
    .replace(/^[.\-\s]+/, '')

  if (name.length > MAX_NAME_LENGTH) {
    const cut = name.slice(0, MAX_NAME_LENGTH)
    const lastSpace = cut.lastIndexOf(' ')
    // Prefer a word boundary, but not one so early it loses the sense.
    name = (lastSpace > MAX_NAME_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trim()
  }

  // A trailing dot or space is legal on disk but confuses every tool.
  name = name.replace(/[.\s]+$/, '')
  if (!name) return null

  const hasExtension = MARKDOWN_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
  return hasExtension ? name : `${name}.md`
}

/** The file name a document should have, or null while it has no title. */
export function fileNameForDocument(text: string): string | null {
  const title = documentTitle(text)
  return title ? fileNameForTitle(title) : null
}
