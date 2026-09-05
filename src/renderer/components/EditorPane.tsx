import { useEffect, useRef } from 'react'
import { editorController } from '../editor/editorController.ts'

/**
 * Hosts the CodeMirror view. It mounts once and never re-renders on document
 * change -- the text lives in CodeMirror's state, not React's.
 */
export default function EditorPane() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current) return
    return editorController.mount(host.current)
  }, [])

  return <div className="editor-host" ref={host} />
}
