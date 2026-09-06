import { StateField, type Extension } from '@codemirror/state'

/**
 * Whether the live preview is allowed to reveal raw syntax at the caret.
 *
 * A freshly opened document starts with the selection at offset 0, which sits
 * inside the first heading -- so gating on the caret alone would show `# ` the
 * instant a file loads. Revealing should begin only once a caret has actually
 * been placed, so this stays false until a transaction carries an explicit
 * selection, then remains true for the life of the document.
 *
 * Deliberately *not* gated on view focus: a web view cannot hold DOM focus
 * while its window is in the background, so a focus gate would make the whole
 * document re-render every time the user switched apps.
 */
export const revealEnabled = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => value || tr.selection != null,
})

export const revealState = (): Extension => revealEnabled
