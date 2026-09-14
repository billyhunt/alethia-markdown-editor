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

/** requestMeasure flushes on an animation frame; jsdom implements rAF. */
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

  it('does not leave the URL decorated as a clickable link under the image', () => {
    // The Image case returns false so its children are not visited; if it
    // returned true the URL child would get the link mark and a stray
    // data-href would sit inside a replaced range.
    const v = mount(DOC, '/notes/n.md')
    v.dispatch({ selection: EditorSelection.cursor(0) })
    expect(v.contentDOM.querySelector('.cm-md-link')).toBeNull()
  })
})
