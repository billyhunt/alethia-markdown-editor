import { afterEach, describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { closeSearchPanel, getSearchQuery, searchPanelOpen, setSearchQuery, SearchQuery } from '@codemirror/search'
import { createEditorState } from '../../src/renderer/editor/createEditor.ts'
import { SEARCH_COMMANDS, searchFocusPlan } from '../../src/renderer/editor/searchCommands.ts'

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

  it('shows the replace field and focuses the search field on find and replace', () => {
    const v = mount()
    SEARCH_COMMANDS.findReplace(v)

    // CodeMirror has one panel and it always carries replace, so the item
    // exists for discoverability. Focus follows the platform: TextEdit and
    // Xcode both put the caret in the search field here, and focusing replace
    // would send the first thing typed to the wrong place.
    expect(v.dom.querySelector('.cm-search input[name="replace"]')).not.toBeNull()
    expect((document.activeElement as HTMLInputElement | null)?.name).toBe('search')
  })

  it('leaves focus in the search field on plain find', () => {
    const v = mount()
    SEARCH_COMMANDS.find(v)

    // The distinction between the two menu items is this and nothing else,
    // so a regression here silently merges them.
    expect((document.activeElement as HTMLInputElement | null)?.name).toBe('search')
  })

  it('keeps the replacement when find is invoked from the replace field with a match selected', () => {
    const v = mount()
    SEARCH_COMMANDS.find(v)
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'beta', replace: 'gamma' })) })
    v.dispatch({ selection: EditorSelection.range(6, 10) })
    const replaceField = v.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')!
    replaceField.focus()
    expect(document.activeElement).toBe(replaceField)

    SEARCH_COMMANDS.find(v)

    // With the panel open and focus off the search field, openSearchPanel
    // rebuilds the query from the selection through defaultQuery, which has
    // no replace. The next Replace would then delete the match.
    expect(getSearchQuery(v.state).search).toBe('beta')
    expect(getSearchQuery(v.state).replace).toBe('gamma')
    expect(replaceField.value).toBe('gamma')
  })

  it('keeps the replacement when find reopens a closed panel over a selected match', () => {
    const v = mount()
    SEARCH_COMMANDS.find(v)
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'beta', replace: 'gamma' })) })
    closeSearchPanel(v)
    v.dispatch({ selection: EditorSelection.range(6, 10) })

    SEARCH_COMMANDS.find(v)

    expect(getSearchQuery(v.state).replace).toBe('gamma')
  })

  it('seeds the query from the selection', () => {
    const v = mount()
    v.dispatch({ selection: EditorSelection.range(6, 10) })
    expect(SEARCH_COMMANDS.useSelectionForFind(v)).toBe(true)
    expect(getSearchQuery(v.state).search).toBe('beta')
  })

  it('seeds a selection longer than CodeMirror will take on its own', () => {
    // CodeMirror's defaultQuery ignores a selection over 100 characters, so
    // the short case above passes even with this command's body removed.
    // Only our own dispatch can put this text in the query.
    const long = 'x'.repeat(150)
    const v = mount(`${long}\ntail`)
    v.dispatch({ selection: EditorSelection.range(0, long.length) })
    SEARCH_COMMANDS.useSelectionForFind(v)

    expect(getSearchQuery(v.state).search).toBe(long)
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

  it('keeps an existing replacement when seeding from the selection', () => {
    const v = mount()
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'x', replace: 'gamma' })) })
    v.dispatch({ selection: EditorSelection.range(6, 10) })
    SEARCH_COMMANDS.useSelectionForFind(v)

    // Opening the panel reseeds the query through CodeMirror's own
    // defaultQuery, which keeps the flags but drops the replacement. Setting
    // the query before opening therefore loses it, and the next Replace would
    // delete the match instead of substituting.
    expect(getSearchQuery(v.state).search).toBe('beta')
    expect(getSearchQuery(v.state).replace).toBe('gamma')
  })

  it('escapes newlines in a multi-line selection the way CodeMirror does', () => {
    // Over 100 characters, which is the point where CodeMirror stops seeding
    // (and escaping) from the selection for us.
    const block = `${'a'.repeat(60)}\n${'b'.repeat(60)}`
    const doc = `head\n${block}\ntail`
    const v = mount(doc)
    const from = doc.indexOf(block)
    v.dispatch({ selection: EditorSelection.range(from, from + block.length) })
    SEARCH_COMMANDS.useSelectionForFind(v)

    // A raw newline survives in the query object but is stripped the moment
    // the panel's single-line input commits its value back, silently changing
    // what is being searched for.
    const query = getSearchQuery(v.state)
    expect(query.literal).toBe(false)
    expect(query.search).not.toContain('\n')
    expect(query.search).toContain('\\n')
    // The escape is the query's encoding of a newline, so it still matches
    // the two real lines.
    expect(query.unquoted).toContain('\n')
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

describe('searchFocusPlan', () => {
  it('leaves focus alone when it is already inside the editor', () => {
    const v = mount()
    SEARCH_COMMANDS.find(v)
    const queryField = v.dom.querySelector('input[name="search"]')

    // Find Next from the menu while the query is being typed must not pull
    // the caret into the document, or the next keystroke would overwrite the
    // selected match instead of editing the search term.
    expect(searchFocusPlan(v, queryField)).toBe('keep-focus')
    expect(searchFocusPlan(v, v.contentDOM)).toBe('keep-focus')
  })

  it('ignores the command while another field is being typed into', () => {
    const v = mount()
    const rename = document.createElement('input')
    document.body.append(rename)

    // The sidebar's rename field, mid-rename. Menu accelerators are global,
    // so Cmd+F arrives here too; abandoning the rename would be worse than
    // doing nothing.
    expect(searchFocusPlan(v, rename)).toBe('ignore')

    const note = document.createElement('div')
    // Set through the attribute: jsdom implements neither the
    // `contentEditable` setter nor `isContentEditable`.
    note.setAttribute('contenteditable', 'true')
    document.body.append(note)
    expect(searchFocusPlan(v, note)).toBe('ignore')
  })

  it('takes focus from anywhere that is not a text field', () => {
    const v = mount()
    const button = document.createElement('button')
    document.body.append(button)

    expect(searchFocusPlan(v, button)).toBe('take-focus')
    expect(searchFocusPlan(v, document.body)).toBe('take-focus')
    expect(searchFocusPlan(v, null)).toBe('take-focus')
  })
})
