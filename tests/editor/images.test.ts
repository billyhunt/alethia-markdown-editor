import { afterEach, describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createEditorState } from '../../src/renderer/editor/createEditor.ts'
import { useDocumentStore } from '../../src/renderer/state/documentStore.ts'

const DOC = '# Preview\n\n![app icon](assets/icon.png)\n'
const DOCUMENT_PATH = '/notes/today.md'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
  useDocumentStore.getState().load({ filePath: null, text: '', mtimeMs: null })
})

function render(filePath: string | null, cursor = 0): HTMLElement {
  useDocumentStore.getState().load({ filePath, text: DOC, mtimeMs: 0 })
  const state = createEditorState(DOC).update({ selection: EditorSelection.cursor(cursor) }).state
  const parent = document.createElement('div')
  document.body.append(parent)
  view = new EditorView({ state, parent })
  return parent
}

describe('local image decorations', () => {
  it('replaces an inactive relative image with the grant-checked protocol URL', () => {
    const image = render(DOCUMENT_PATH).querySelector<HTMLImageElement>('.cm-md-image')
    expect(image).not.toBeNull()

    const url = new URL(image?.src ?? '')
    expect(url.protocol).toBe('alethia-image:')
    expect(url.searchParams.get('document')).toBe(DOCUMENT_PATH)
    expect(url.searchParams.get('target')).toBe('assets/icon.png')
  })

  it('keeps image Markdown visible without a saved document path', () => {
    const parent = render(null)
    expect(parent.querySelector('.cm-md-image')).toBeNull()
    expect(parent.textContent).toContain('![app icon](assets/icon.png)')
  })

  it('reveals image Markdown when the caret enters the image node', () => {
    const parent = render(DOCUMENT_PATH, DOC.indexOf('icon.png'))
    expect(parent.querySelector('.cm-md-image')).toBeNull()
    expect(parent.textContent).toContain('![app icon](assets/icon.png)')
  })

  it('does not render a remote image through the local protocol', () => {
    const remoteDoc = '![remote](https://example.com/image.png)'
    useDocumentStore.getState().load({ filePath: DOCUMENT_PATH, text: remoteDoc, mtimeMs: 0 })
    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({ state: createEditorState(remoteDoc), parent })
    expect(parent.querySelector('.cm-md-image')).toBeNull()
  })
})
