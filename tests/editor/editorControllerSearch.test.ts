import { afterEach, describe, expect, it } from 'vitest'
import { searchPanelOpen } from '@codemirror/search'
import { editorController } from '../../src/renderer/editor/editorController.ts'

let unmount: (() => void) | null = null

function mounted(doc = 'alpha beta\nbeta gamma'): void {
  const parent = document.createElement('div')
  document.body.append(parent)
  unmount = editorController.mount(parent)
  editorController.setDocument(doc)
}

const panelOpen = (): boolean => {
  const state = editorController.getState()
  return state ? searchPanelOpen(state) : false
}

afterEach(() => {
  unmount?.()
  unmount = null
  document.body.replaceChildren()
})

describe('editorController.search', () => {
  it('runs the command when focus is not in some other field', () => {
    mounted()
    expect(editorController.search('find')).toBe(true)
    expect(panelOpen()).toBe(true)
  })

  it('does nothing while another field is being typed into', () => {
    mounted()
    const rename = document.createElement('input')
    document.body.append(rename)
    rename.focus()

    // Menu accelerators are app-global, so Cmd+F fires during a sidebar
    // rename. Opening the panel would abandon the rename in progress, and
    // taking focus into the document is worse still.
    expect(editorController.search('find')).toBe(false)
    expect(panelOpen()).toBe(false)
  })

  it('still runs when focus is inside the editor, including its panel', () => {
    mounted()
    editorController.search('find')
    const queryField = document.querySelector<HTMLInputElement>('input[name="search"]')
    queryField?.focus()

    // The panel's own field is an input too, so a naive "is a field focused"
    // check would refuse Find Next from the menu while a query is being
    // typed.
    expect(editorController.search('findNext')).toBe(true)
  })

  it('is a no-op with nothing mounted', () => {
    expect(editorController.search('find')).toBe(false)
  })
})
