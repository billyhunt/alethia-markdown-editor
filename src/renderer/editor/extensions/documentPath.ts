import { Compartment, Facet, type Extension } from '@codemirror/state'

/**
 * Where the open document lives on disk, or null for one that has never been
 * saved. Relative image sources resolve against its directory, so decorations
 * need to know it; nothing else in the editor does.
 */
export const documentPath = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null,
})

export const documentPathCompartment = new Compartment()

export const documentPathExtension = (filePath: string | null): Extension =>
  documentPathCompartment.of(documentPath.of(filePath))
