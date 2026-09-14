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
 * Same panel as Find -- CodeMirror has one panel carrying both fields -- but
 * the caret lands in the replace input, which is the only thing that
 * distinguishes the two menu items.
 */
const findAndReplace: Command = (view) => {
  const opened = openSearchPanel(view)
  focusField(view, 'input[name="replace"]')
  return opened
}

/**
 * Seeds the query from the selection, the way Xcode and TextEdit do, so
 * Find Next can be used without retyping what is already highlighted. An
 * empty selection just opens the panel.
 */
const useSelectionForFind: Command = (view) => {
  const { from, to } = view.state.selection.main
  if (from === to) return openSearchPanel(view)

  const current = getSearchQuery(view.state)
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: view.state.sliceDoc(from, to),
        // Everything except the search text is the user's existing choice.
        caseSensitive: current.caseSensitive,
        literal: current.literal,
        regexp: current.regexp,
        wholeWord: current.wholeWord,
        replace: current.replace,
      }),
    ),
  })
  return openSearchPanel(view)
}

export const SEARCH_COMMANDS: Record<SearchCommand, Command> = {
  find,
  findReplace: findAndReplace,
  findNext,
  findPrevious,
  useSelectionForFind,
}
