import { Annotation } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import { imageRequestUrl, isRemoteSource } from '../../../shared/images.ts'

/**
 * Why an image is shown as a placeholder instead of pixels. Each is a state
 * the user can act on, so the placeholder says which.
 */
export type ImageProblem = 'unsaved' | 'remote' | 'failed'

/**
 * What an `![alt](src)` should render as, decided once per decoration pass.
 * Pure, so the rules can be tested without a DOM.
 */
export function resolveImageSource(
  src: string,
  docPath: string | null,
): { url: string } | { problem: ImageProblem } {
  if (isRemoteSource(src)) {
    // The CSP allows no network egress, deliberately. Rendering remote images
    // would be a tracking channel in a notes app; say so rather than fail
    // silently.
    return { problem: 'remote' }
  }
  if (docPath === null) {
    // A relative path has nothing to be relative to until the file is saved.
    return { problem: 'unsaved' }
  }
  return { url: imageRequestUrl(docPath, src) }
}

/**
 * Images that failed to load, by request URL, so the next decoration pass
 * renders their placeholder instead of trying again on every rebuild.
 *
 * A widget's DOM belongs to CodeMirror once `toDOM` has returned. Swapping
 * nodes inside it from the img's async `error` callback races the editor's
 * own DOM sync and, in practice, leaves the placeholder text adrift in the
 * line with no element around it. So a failure is recorded here and the
 * editor is asked to redraw; the placeholder then comes from `toDOM` like any
 * other widget content.
 */
const failedImages = new Set<string>()

/** Marks a transaction whose only purpose is to redraw after an image failed. */
export const imageFailed = Annotation.define<string>()

/**
 * Forgets every recorded failure. Called when the document or its path
 * changes: a file that was missing may exist now, and reopening the note is
 * how a user retries. Within one document's life a failure is not retried,
 * so a missing image does not hit the disk on every keystroke.
 */
export const forgetImageFailures = (): void => failedImages.clear()

const PROBLEM_TEXT: Record<ImageProblem, string> = {
  unsaved: 'Save the document to see this image',
  remote: 'Remote images are not loaded',
  failed: 'Image not found',
}

export class ImageWidget extends WidgetType {
  readonly src: string
  readonly alt: string
  readonly docPath: string | null
  /**
   * Decided at construction, not read live: the widget built before the
   * failure and the one built after must compare unequal, or CodeMirror keeps
   * the old DOM and the placeholder never appears.
   */
  private readonly outcome: { url: string } | { problem: ImageProblem }

  constructor(src: string, alt: string, docPath: string | null) {
    super()
    this.src = src
    this.alt = alt
    this.docPath = docPath
    const resolved = resolveImageSource(src, docPath)
    this.outcome =
      'url' in resolved && failedImages.has(resolved.url) ? { problem: 'failed' } : resolved
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.docPath === this.docPath &&
      'url' in other.outcome === 'url' in this.outcome
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const outcome = this.outcome
    if ('problem' in outcome) return placeholder(this.src, this.alt, outcome.problem)

    const img = document.createElement('img')
    img.className = 'cm-md-image'
    img.alt = this.alt
    img.title = this.src
    img.draggable = false
    img.decoding = 'async'
    img.src = outcome.url

    // The line's height changes when the bitmap arrives; without this the
    // editor's layout stays measured against the empty img box.
    img.addEventListener('load', () => view.requestMeasure(), { once: true })
    img.addEventListener(
      'error',
      () => {
        failedImages.add(outcome.url)
        // Deferred a full frame. For a URL the protocol rejects outright,
        // `error` fires while CodeMirror is still inside the update that
        // created this widget, and dispatching from there throws "Calls to
        // EditorView.update are not allowed while an update is in progress".
        // In a real window that exception surfaced as the line being rebuilt
        // as bare text. A microtask is still inside the same update; the
        // measure phase's `write` callback is too. The next animation frame
        // is the first point that is reliably outside it.
        // No change to the document; the annotation tells the decoration
        // plugin to rebuild, and that rebuild produces the placeholder.
        requestAnimationFrame(() => {
          if (view.dom.isConnected) view.dispatch({ annotations: imageFailed.of(outcome.url) })
        })
      },
      { once: true },
    )
    return img
  }

  /** Clicking the image places the caret on it, which reveals the source. */
  ignoreEvent(): boolean {
    return false
  }
}

function placeholder(src: string, alt: string, problem: ImageProblem): HTMLElement {
  const box = document.createElement('span')
  box.className = `cm-md-image-placeholder cm-md-image-${problem}`
  box.title = src

  const label = document.createElement('span')
  label.className = 'cm-md-image-placeholder-label'
  label.textContent = alt || src
  box.append(label)

  const reason = document.createElement('span')
  reason.className = 'cm-md-image-placeholder-reason'
  reason.textContent = PROBLEM_TEXT[problem]
  box.append(reason)
  return box
}
