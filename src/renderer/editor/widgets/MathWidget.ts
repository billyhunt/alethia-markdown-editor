import { WidgetType } from '@codemirror/view'
import katex from 'katex'

/** Renders a TeX span with KaTeX; invalid input shows the error, not a crash. */
export class MathWidget extends WidgetType {
  readonly source: string
  readonly display: boolean

  constructor(source: string, display: boolean) {
    super()
    this.source = source
    this.display = display
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.display ? 'div' : 'span')
    element.className = this.display ? 'cm-md-math-block' : 'cm-md-math-inline'
    element.innerHTML = katex.renderToString(this.source, {
      throwOnError: false,
      displayMode: this.display,
    })
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}
