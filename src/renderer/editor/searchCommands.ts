import type { EditorView, Command } from '@codemirror/view'
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  setSearchQuery,
} from '@codemirror/search'
import type { SearchCommand } from '../../shared/ipc.ts'

/**
 * Search needs the view, not just the state: the panel is a view construct,
 * so these are `Command`s and cannot join the `StateCommand` table in
 * `commands.ts`.
 */

/** A field of CodeMirror's default search panel, once it exists. */
const panelField = (view: EditorView, selector: string): HTMLInputElement | null =>
  view.dom.querySelector<HTMLInputElement>(`.cm-search ${selector}`)

/**
 * The panel is created inside the dispatch that opens it (the panel plugin
 * mounts it during its own `update`), so its fields are already in the DOM
 * by the time `openSearchPanel` returns and a focus call here lands after
 * CodeMirror's own. If a future version defers mounting, the panel still
 * opens and only the focus hop is lost.
 */
const focusField = (view: EditorView, selector: string): void => {
  const field = panelField(view, selector)
  if (!field) return
  field.focus()
  field.select()
}

/**
 * CodeMirror's panel focuses its search field by calling `select()`, which is
 * not specified to move focus, so the focus is made explicit here rather than
 * left to browser behaviour.
 */
const find: Command = (view) => {
  const opened = openSearchPanel(view)
  focusField(view, '[main-field]')
  return opened
}

/**
 * CodeMirror has a single panel and it always carries the replace field, so
 * there is nothing for this to open that Find does not. Focus goes to the
 * search field, as it does in TextEdit, Xcode and Pages: you know what to
 * look for before you know what to put in its place. The separate menu item
 * exists so that replace is discoverable at all, since nothing else in the
 * app mentions it.
 */
const findAndReplace: Command = find

/**
 * Seeds the query from the selection, the way Xcode and TextEdit do, so
 * Find Next can be used without retyping what is already highlighted. An
 * empty selection just opens the panel.
 */
const useSelectionForFind: Command = (view) => {
  const { from, to } = view.state.selection.main
  if (from === to) return openSearchPanel(view)

  // Read the query before opening: opening reseeds it from the selection.
  const current = getSearchQuery(view.state)
  const selected = view.state.sliceDoc(from, to)

  // Opening the panel runs CodeMirror's own `defaultQuery`, which keeps the
  // flags but drops the replacement, so the intended query has to be
  // dispatched *after* the panel exists or it would be overwritten -- and a
  // silently emptied replacement turns the next Replace into a deletion.
  const opened = openSearchPanel(view)
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        // Outside literal mode a query stores newlines as the two-character
        // escape `\n`, which is also what CodeMirror's own defaultQuery
        // writes. A raw newline would survive here but be stripped the
        // moment the panel's single-line input committed its value back.
        search: current.literal ? selected : selected.replace(/\n/g, '\\n'),
        // Everything except the search text is the user's existing choice.
        caseSensitive: current.caseSensitive,
        literal: current.literal,
        regexp: current.regexp,
        wholeWord: current.wholeWord,
        replace: current.replace,
      }),
    ),
  })
  return opened
}

/** What a menu-driven search command should do about focus. */
export type FocusPlan = 'ignore' | 'keep-focus' | 'take-focus'

/**
 * `isContentEditable` is the right property but is unimplemented in jsdom,
 * so the attribute is checked too -- which is also the more explicit read of
 * what the markup asked for.
 */
const isEditableHost = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const attribute = element.getAttribute('contenteditable')
  return attribute === '' || attribute === 'true'
}

const isTextEntry = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element !== null && isEditableHost(element))

/**
 * Menu accelerators are app-global: Cmd+F and Cmd+G fire wherever focus sits,
 * including the search panel's own query field and the sidebar's rename
 * field. Taking focus unconditionally would move the caret into the document
 * mid-query, so the next keystroke would overwrite the selected match instead
 * of editing the search term, and would abandon a rename in progress.
 */
export function searchFocusPlan(view: EditorView, active: Element | null): FocusPlan {
  // The editor's DOM contains the search panel, so a caret in the query or
  // replace field is already where it should be.
  if (active && view.dom.contains(active)) return 'keep-focus'
  // Somewhere else that takes typing: leave it alone entirely, matching how
  // undo/redo already defer to native fields.
  if (isTextEntry(active)) return 'ignore'
  return 'take-focus'
}

export const SEARCH_COMMANDS: Record<SearchCommand, Command> = {
  find,
  findReplace: findAndReplace,
  findNext,
  findPrevious,
  useSelectionForFind,
}

/**
 * Narrows the tail of an `edit:` host command. The dispatcher reaches this
 * branch by prefix, and `edit:undo` and `edit:redo` are only excluded by an
 * earlier branch, so a future `edit:` command that is not a search command
 * would otherwise look up `undefined` in the table and throw inside the IPC
 * callback instead of being ignored.
 */
export const isSearchCommand = (value: string): value is SearchCommand =>
  Object.hasOwn(SEARCH_COMMANDS, value)
