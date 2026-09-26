import { WidgetType } from '@codemirror/view'

/** A lazy, bounded local image that reveals its Markdown source at the caret. */
export class ImageWidget extends WidgetType {
  readonly source: string

  constructor(source: string) {
    super()
    this.source = source
  }

  eq(other: ImageWidget): boolean {
    return other.source === this.source
  }

  toDOM(): HTMLElement {
    const image = document.createElement('img')
    image.className = 'cm-md-image'
    image.src = this.source
    image.alt = ''
    image.loading = 'lazy'
    image.decoding = 'async'
    return image
  }

  ignoreEvent(): boolean {
    return false
  }
}
