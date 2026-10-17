import { afterEach, describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { createEditorState } from '../../src/renderer/editor/createEditor.ts'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

/** An editor over `doc` with one caret or range per [anchor, head] pair. */
function editor(doc: string, ranges: [number, number?][]): EditorView {
  const view = new EditorView({ state: createEditorState(doc), parent: document.body })
  view.dispatch({ selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h ?? a))) })
  views.push(view)
  return view
}

function paste(view: EditorView, clip: { html: string; text: string }): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  event.clipboardData = { getData: (type: string) => (type === 'text/html' ? clip.html : type === 'text/plain' ? clip.text : '') }
  view.contentDOM.dispatchEvent(event)
  return event.defaultPrevented
}

const BOLD = { html: '<meta charset="utf-8"><b>bold</b>', text: 'bold' }

describe('pasting rich text into the editor', () => {
  it('converts the HTML in prose', () => {
    const view = editor('hello ', [[6]])
    expect(paste(view, BOLD)).toBe(true)
    expect(view.state.doc.toString()).toBe('hello **bold**')
  })

  it('keeps the plain text at every caret inside code, converting only where markdown means something', () => {
    // Alt-click: a caret in prose first (the primary one), then one in a fence.
    const doc = 'prose\n\n```\ncode\n```\n'
    const view = editor(doc, [[5], [doc.indexOf('code') + 4]])
    expect(paste(view, BOLD)).toBe(true)
    expect(view.state.doc.toString()).toBe('prose**bold**\n\n```\ncodebold\n```\n')
  })

  it('does the mixed paste as a single undo step', () => {
    const doc = 'prose\n\n```\ncode\n```\n'
    const view = editor(doc, [[5], [doc.indexOf('code') + 4]])
    paste(view, BOLD)
    expect(view.state.doc.toString()).not.toBe(doc)
    undo(view)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('starts a pasted heading on its own line when it lands right after text', () => {
    const view = editor('Intro', [[5]])
    paste(view, { html: '<meta charset="utf-8"><h2>Plan</h2>', text: 'Plan' })
    expect(view.state.doc.toString()).toBe('Intro\n\n## Plan')
  })

  it('separates a pasted block from the text that follows it on the line', () => {
    const view = editor('Intro rest', [[5]])
    paste(view, { html: '<meta charset="utf-8"><h2>Plan</h2>', text: 'Plan' })
    expect(view.state.doc.toString()).toBe('Intro\n\n## Plan\n\n rest')
  })

  it('keeps the space around a selected word instead of joining it to its neighbours', () => {
    const view = editor('a|b', [[1, 2]])
    paste(view, { html: '<meta charset="utf-8"><strong> bold </strong>', text: ' bold ' })
    expect(view.state.doc.toString()).toBe('a **bold** b')
  })

  it('leaves oversized HTML to the plain-text paste', () => {
    const view = editor('', [[0]])
    const huge = `<meta charset="utf-8"><b>bold</b>${'<!-- -->'.repeat(300_000)}`
    paste(view, { html: huge, text: 'bold' })
    expect(view.state.doc.toString()).toBe('bold')
  })
})
