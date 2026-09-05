import { WidgetType, EditorView } from '@codemirror/view'

// `erasableSyntaxOnly` is on, so these use explicit field declarations rather
// than constructor parameter properties.

/** Replaces a `-`/`*`/`+` list marker with a real bullet glyph. */
export class BulletWidget extends WidgetType {
  readonly depth: number

  constructor(depth: number) {
    super()
    this.depth = depth
  }

  eq(other: BulletWidget): boolean {
    return other.depth === this.depth
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-bullet'
    span.textContent = this.depth % 2 === 1 ? '◦' : '•'
    return span
  }
}

/** A clickable task-list checkbox that writes back into the document. */
export class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  readonly from: number

  constructor(checked: boolean, from: number) {
    super()
    this.checked = checked
    this.from = from
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-md-checkbox'
    input.checked = this.checked
    input.addEventListener('mousedown', (event) => {
      event.preventDefault()
      // The marker is `[ ]` or `[x]`; only the middle character changes.
      view.dispatch({
        changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? ' ' : 'x' },
      })
    })
    return input
  }

  /** We handle the click ourselves; CodeMirror must not move the caret. */
  ignoreEvent(): boolean {
    return true
  }
}

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = 'cm-md-hr'
    return hr
  }
}

/** The opening fence becomes a small language label; the closing one vanishes. */
export class CodeFenceWidget extends WidgetType {
  readonly language: string

  constructor(language: string) {
    super()
    this.language = language
  }

  eq(other: CodeFenceWidget): boolean {
    return other.language === this.language
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-fence-label'
    span.textContent = this.language
    return span
  }
}
