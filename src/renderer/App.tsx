import { useEffect } from 'react'
import { api } from './api.ts'
import EditorPane from './components/EditorPane.tsx'
import { editorController } from './editor/editorController.ts'
import './styles/editor.css'

export default function App() {
  useEffect(() => {
    void api.app.rendererReady()
    // Temporary: load the kitchen-sink document so the live preview has
    // something to render until the file/sidebar shell lands.
    void fetch('./sample.md')
      .then((response) => response.text())
      .then((text) => editorController.setDocument(text))
  }, [])

  return (
    <div className="app">
      <div className="titlebar" />
      <EditorPane />
    </div>
  )
}
