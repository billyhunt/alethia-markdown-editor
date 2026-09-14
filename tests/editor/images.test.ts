import { afterEach, describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createEditorState } from '../../src/renderer/editor/createEditor.ts'
import { documentPath, documentPathCompartment } from '../../src/renderer/editor/extensions/documentPath.ts'
import {
  forgetImageFailures,
  resolveImageSource,
} from '../../src/renderer/editor/widgets/ImageWidget.ts'

let view: EditorView | null = null

/** The failure redraw is deferred by requestAnimationFrame; jsdom implements it. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

function mount(doc: string, filePath: string | null): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  view = new EditorView({ state: createEditorState(doc, [], { filePath }), parent })
  return view
}

afterEach(() => {
  view?.destroy()
  view = null
  document.body.replaceChildren()
  forgetImageFailures()
})

const DOC = 'Before\n\n![A diagram](assets/diagram.png)\n\nAfter'

describe('resolveImageSource', () => {
  it('builds a scheme URL naming both the document and the source', () => {
    const out = resolveImageSource('assets/a.png', '/notes/n.md')
    expect(out).toHaveProperty('url')
    const url = new URL((out as { url: string }).url)
    expect(url.protocol).toBe('alethia-image:')
    expect(url.searchParams.get('doc')).toBe('/notes/n.md')
    expect(url.searchParams.get('src')).toBe('assets/a.png')
  })

  it('will not guess a base for an unsaved document', () => {
    expect(resolveImageSource('a.png', null)).toEqual({ problem: 'unsaved' })
  })

  it('does not load remote images, and says so', () => {
    expect(resolveImageSource('https://example.com/a.png', '/n.md')).toEqual({
      problem: 'remote',
    })
  })
})

describe('image rendering', () => {
  it('replaces the markdown with an <img> when the caret is elsewhere', () => {
    const v = mount(DOC, '/notes/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })

    const img = v.contentDOM.querySelector<HTMLImageElement>('img.cm-md-image')
    expect(img).not.toBeNull()
    expect(img?.alt).toBe('A diagram')
    expect(new URL(img?.src ?? '').searchParams.get('src')).toBe('assets/diagram.png')
    // The source text is gone from the rendered line.
    expect(v.contentDOM.textContent).not.toContain('![A diagram]')
  })

  it('reveals the source when the caret enters the image', () => {
    const v = mount(DOC, '/notes/n.md')
    const at = DOC.indexOf('](assets') + 1
    v.dispatch({ selection: EditorSelection.cursor(at) })

    expect(v.contentDOM.querySelector('img.cm-md-image')).toBeNull()
    expect(v.contentDOM.textContent).toContain('![A diagram](assets/diagram.png)')
  })

  it('shows a placeholder, not a broken image, for an unsaved document', () => {
    const v = mount(DOC, null)
    v.dispatch({ selection: EditorSelection.cursor(0) })

    expect(v.contentDOM.querySelector('img.cm-md-image')).toBeNull()
    const box = v.contentDOM.querySelector('.cm-md-image-placeholder')
    expect(box?.textContent).toContain('Save the document')
    expect(box?.textContent).toContain('A diagram')
  })

  it('starts rendering once the document gains a path', () => {
    // A new note gets its path when autosave files it; the image should
    // appear then without reopening anything.
    const v = mount(DOC, null)
    v.dispatch({ selection: EditorSelection.cursor(0) })
    expect(v.contentDOM.querySelector('img.cm-md-image')).toBeNull()

    v.dispatch({
      effects: documentPathCompartment.reconfigure(documentPath.of('/notes/n.md')),
    })
    expect(v.contentDOM.querySelector('img.cm-md-image')).not.toBeNull()
  })

  it('turns a failed image into a styled placeholder, inside an element', async () => {
    const v = mount(DOC, '/notes/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })
    const img = v.contentDOM.querySelector<HTMLImageElement>('img.cm-md-image')
    expect(img).not.toBeNull()

    // jsdom never loads images, so fire the event the browser would. The
    // redraw is deferred through requestMeasure, so wait for a frame.
    img?.dispatchEvent(new Event('error'))
    await nextFrame()

    // The placeholder must arrive through a decoration rebuild, as an element
    // with its class, not as text swapped into the line behind CodeMirror's
    // back (which is what a naive img.replaceWith produced in a real window).
    expect(v.contentDOM.querySelector('img.cm-md-image')).toBeNull()
    const box = v.contentDOM.querySelector('.cm-md-image-placeholder.cm-md-image-failed')
    expect(box).not.toBeNull()
    expect(box?.textContent).toContain('Image not found')
    expect(box?.textContent).toContain('A diagram')
  })

  it('never changes the document text when an image fails', async () => {
    // The first version of this widget swapped the img for a placeholder
    // inside CodeMirror's DOM. CodeMirror read that back as typed input and
    // autosave wrote "Image not found" into the file on disk. A widget may
    // only change what is *rendered*; the document is the user's.
    const v = mount(DOC, '/notes/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })
    v.contentDOM.querySelector('img.cm-md-image')?.dispatchEvent(new Event('error'))
    await nextFrame()

    expect(v.state.doc.toString()).toBe(DOC)
    expect(v.contentDOM.querySelector('.cm-md-image-failed')).not.toBeNull()
  })

  it('remembers a failure across rebuilds instead of retrying every keystroke', async () => {
    const v = mount(DOC, '/notes/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })
    v.contentDOM.querySelector('img.cm-md-image')?.dispatchEvent(new Event('error'))
    await nextFrame()
    expect(v.contentDOM.querySelector('.cm-md-image-failed')).not.toBeNull()

    // A rebuild for an unrelated reason: the caret moves elsewhere.
    v.dispatch({ selection: EditorSelection.cursor(3) })
    expect(v.contentDOM.querySelector('img.cm-md-image')).toBeNull()
    expect(v.contentDOM.querySelector('.cm-md-image-failed')).not.toBeNull()
  })

  it('does not turn a plain link into an image', () => {
    const v = mount('See [the docs](https://example.com) here', '/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })
    expect(v.contentDOM.querySelector('img.cm-md-image, .cm-md-image-placeholder')).toBeNull()
    expect(v.contentDOM.querySelector('.cm-md-link')).not.toBeNull()
  })

  it('leaves a multi-line image as source rather than crashing the view', () => {
    // Alt text may legally span lines. Replacing across a line break from a
    // ViewPlugin makes CodeMirror throw "Decorations that replace line breaks
    // may not be specified via plugins", which would take the editor down on
    // a valid document.
    const doc = 'Before\n\n![first\nsecond](photo.png)\n\nAfter'
    const v = mount(doc, '/notes/n.md')
    expect(() => v.dispatch({ selection: EditorSelection.cursor(0) })).not.toThrow()
    expect(v.contentDOM.querySelector('img.cm-md-image')).toBeNull()
    expect(v.contentDOM.textContent).toContain('![first')
    expect(v.state.doc.toString()).toBe(doc)
  })

  it('replaces exactly the image node and nothing around it', () => {
    const v = mount('a ![x](p.png) b', '/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })
    const line = v.contentDOM.querySelector('.cm-line')
    expect(line?.textContent).toBe('a  b')
    expect(line?.querySelectorAll('img.cm-md-image')).toHaveLength(1)
  })
})

describe('editorController and the document path', () => {
  it('keeps the document path across a remount', async () => {
    const { editorController } = await import('../../src/renderer/editor/editorController.ts')
    const parent = document.createElement('div')
    document.body.append(parent)
    let unmount = editorController.mount(parent)
    editorController.setFilePath('/notes/n.md')
    editorController.setDocument(DOC)

    // Remount, as React does in StrictMode and on layout changes. The path
    // was known; forgetting it turns every image into a "save the document"
    // placeholder until the path happens to change.
    unmount()
    unmount = editorController.mount(parent)
    // Asserted before any setDocument: that call rebuilds state with the
    // controller's path anyway, and would hide a mount that forgot it.
    expect(editorController.getState()?.facet(documentPath)).toBe('/notes/n.md')
    unmount()
  })
})
