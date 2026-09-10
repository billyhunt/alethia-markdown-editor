/**
 * Naming a document after what it says.
 *
 * A new buffer is saved automatically under its own title rather than through
 * a Save As dialog, so the title has to survive becoming a file name: no
 * separators, no leading dot, nothing long enough to be unreadable in a
 * sidebar, and nothing that renders as something other than what it is.
 *
 * Pure and shared, so main and renderer agree on the name and the rules are
 * testable without a window.
 */
import { MARKDOWN_EXTENSIONS } from './markdown.ts'

/**
 * YAML front matter is metadata, not the first line of the document. Only a
 * fence followed by a `key:` line counts, so a document that opens with a
 * thematic break keeps its first heading.
 */
const FRONT_MATTER =
  /^---\r?\n(?=[ \t]*[\w.-]+[ \t]*:(?:[ \t]|\r?\n))[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/

/**
 * Path separators, macOS's colon, and anything that is not really a
 * character: control codes, format codes such as U+202E (which would reverse
 * how the rest of the name renders in Finder), and stray surrogates.
 */
const ILLEGAL = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Cs}]/gu

/** A name has to be something, not just padding and separators. */
const HAS_MEANING = /[^\s.\-_]/u

const HORIZONTAL_RULE = /^(?:-{3,}|_{3,}|\*{3,})$/
const FENCE = /^(?:```|~~~)/
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/
const TASK_MARKER = /^\[[ xX]\]\s+/
/** `[label]: https://…` is plumbing, not a title. */
const REFERENCE_DEFINITION = /^\[[^\]]+\]:\s/
/** `|---|---|` under a table header. */
const TABLE_DELIMITER = /^\|?[\s:|-]+\|[\s:|-]*$/

/** Long enough to stay recognisable, short enough to read in a file list. */
const MAX_NAME_LENGTH = 60

/** Strips the markdown around a line so only its words remain. */
function plainText(line: string): string {
  return (
    line
      .replace(/^#{1,6}(?:\s+|$)/, '')
      .replace(/^>\s?/, '')
      .replace(LIST_MARKER, '')
      .replace(TASK_MARKER, '')
      // Links and images keep their visible text, not their target.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/[*_~`]/g, '')
      // A leading table row reads as its cells, not as its pipes.
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Lines that are structure or plumbing rather than something to be called. */
const isSkippable = (line: string): boolean =>
  line === '' ||
  HORIZONTAL_RULE.test(line) ||
  TABLE_DELIMITER.test(line) ||
  REFERENCE_DEFINITION.test(line)

interface Pass {
  /** False to read through an unterminated fence. */
  honourFences: boolean
  /** True to accept only a heading, which survives a misread fence best. */
  headingsOnly?: boolean
}

function firstTitleIn(lines: string[], { honourFences, headingsOnly }: Pass): string | null {
  let inFence = false
  let inComment = false

  for (const raw of lines) {
    const line = raw.trim()

    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    // A licence header or a markdownlint pragma is not what the document is
    // called.
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true
      continue
    }
    if (FENCE.test(line)) {
      // The fallback pass still skips the fence itself; it just stops
      // treating everything after it as code.
      if (honourFences) inFence = !inFence
      continue
    }
    if (inFence || isSkippable(line)) continue
    if (headingsOnly && !line.startsWith('#')) continue

    const title = plainText(line)
    if (title) return title
  }
  return null
}

/**
 * The document's title: its first heading, or failing that its first line of
 * prose. Null when there is nothing to go on yet.
 */
export function documentTitle(text: string): string | null {
  const lines = text.replace(FRONT_MATTER, '').split('\n')
  // A document that opens with an unclosed fence would otherwise never have
  // a title at all, and so would never be filed and never say why. Its own
  // heading is the best guess available; failing that, its first line.
  return (
    firstTitleIn(lines, { honourFences: true }) ??
    firstTitleIn(lines, { honourFences: false, headingsOnly: true }) ??
    firstTitleIn(lines, { honourFences: false })
  )
}

/**
 * Turns a title into a markdown file name. Null when nothing usable survives
 * sanitising, e.g. a document whose first line is only punctuation.
 */
export function fileNameForTitle(title: string): string | null {
  let name = title
    .replace(ILLEGAL, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot would hide the file; a leading dash reads as a flag.
    .replace(/^[.\-\s]+/, '')

  // Sliced by character, not by code unit: cutting a surrogate pair in half
  // would leave a name the filesystem stores as U+FFFD, which no later
  // comparison against the title could ever match.
  const characters = Array.from(name)
  if (characters.length > MAX_NAME_LENGTH) {
    const cut = characters.slice(0, MAX_NAME_LENGTH).join('')
    const lastSpace = cut.lastIndexOf(' ')
    // Prefer a word boundary, but not one so early it loses the sense.
    name = (lastSpace > MAX_NAME_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trim()
  }

  // A trailing dot or space is legal on disk but confuses every tool.
  name = name.replace(/[.\s-]+$/, '')
  if (!HAS_MEANING.test(name)) return null

  const hasExtension = MARKDOWN_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
  return hasExtension ? name : `${name}.md`
}

/** The file name a document should have, or null while it has no title. */
export function fileNameForDocument(text: string): string | null {
  const title = documentTitle(text)
  return title ? fileNameForTitle(title) : null
}
