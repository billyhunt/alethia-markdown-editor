import { afterEach, describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getSearchQuery, searchPanelOpen, setSearchQuery, SearchQuery } from '@codemirror/search'
import { createEditorState } from '../../src/renderer/editor/createEditor.ts'
import { SEARCH_COMMANDS } from '../../src/renderer/editor/searchCommands.ts'

const DOC = 'alpha beta\nbeta gamma\ngamma alpha'

let view: EditorView | null = null

/** A mounted view, since the search panel only exists at the view level. */
function mount(doc = DOC): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  view = new EditorView({ state: createEditorState(doc), parent })
  return view
}

afterEach(() => {
  view?.destroy()
  view = null
  document.body.replaceChildren()
})

describe('SEARCH_COMMANDS', () => {
  it('opens the search panel on find', () => {
    const v = mount()
    expect(searchPanelOpen(v.state)).toBe(false)
    expect(SEARCH_COMMANDS.find(v)).toBe(true)
    expect(searchPanelOpen(v.state)).toBe(true)
  })

  it('puts focus in the replace field on find and replace', () => {
    const v = mount()
    SEARCH_COMMANDS.findReplace(v)

    const focused = document.activeElement
    expect(focused).toBeInstanceOf(HTMLInputElement)
    expect((focused as HTMLInputElement).name).toBe('replace')
  })

  it('leaves focus in the search field on plain find', () => {
    const v = mount()
    SEARCH_COMMANDS.find(v)

    // The distinction between the two menu items is this and nothing else,
    // so a regression here silently merges them.
    expect((document.activeElement as HTMLInputElement | null)?.name).toBe('search')
  })

  it('seeds the query from the selection', () => {
    const v = mount()
    v.dispatch({ selection: EditorSelection.range(6, 10) })
    expect(SEARCH_COMMANDS.useSelectionForFind(v)).toBe(true)
    expect(getSearchQuery(v.state).search).toBe('beta')
  })

  it('keeps the existing query options when seeding from the selection', () => {
    const v = mount()
    v.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: 'x', caseSensitive: true, regexp: true })),
    })
    v.dispatch({ selection: EditorSelection.range(6, 10) })
    SEARCH_COMMANDS.useSelectionForFind(v)

    const query = getSearchQuery(v.state)
    expect(query.search).toBe('beta')
    expect(query.caseSensitive).toBe(true)
    expect(query.regexp).toBe(true)
  })

  it('opens the panel without a query when nothing is selected', () => {
    const v = mount()
    v.dispatch({ selection: EditorSelection.cursor(3) })
    expect(SEARCH_COMMANDS.useSelectionForFind(v)).toBe(true)
    expect(searchPanelOpen(v.state)).toBe(true)
    expect(getSearchQuery(v.state).search).toBe('')
  })

  it('moves the selection forward and back through matches', () => {
    const v = mount()
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'beta' })) })
    v.dispatch({ selection: EditorSelection.cursor(0) })

    expect(SEARCH_COMMANDS.findNext(v)).toBe(true)
    expect(v.state.selection.main).toMatchObject({ from: 6, to: 10 })

    expect(SEARCH_COMMANDS.findNext(v)).toBe(true)
    expect(v.state.selection.main).toMatchObject({ from: 11, to: 15 })

    expect(SEARCH_COMMANDS.findPrevious(v)).toBe(true)
    expect(v.state.selection.main).toMatchObject({ from: 6, to: 10 })
  })

  it('searches the source text, not what the decorations render', () => {
    // The document is the markdown, so a search for syntax has to hit even
    // though the caret is nowhere near it and the markers are decorated away.
    const v = mount('# Heading\n\nsome **bold** text')
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '**bold**' })) })
    v.dispatch({ selection: EditorSelection.cursor(0) })

    expect(SEARCH_COMMANDS.findNext(v)).toBe(true)
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe('**bold**')
  })
})
