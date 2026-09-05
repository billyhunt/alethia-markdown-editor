import { useEffect } from 'react'
import Banner from './components/Banner.tsx'
import EditorPane from './components/EditorPane.tsx'
import Sidebar from './components/Sidebar.tsx'
import StatusBar from './components/StatusBar.tsx'
import Titlebar from './components/Titlebar.tsx'
import { editorController } from './editor/editorController.ts'
import { countChars, countWords, extractOutline } from './editor/docStats.ts'
import { useDocumentTitle, useHostEvents } from './hooks/useHostEvents.ts'
import { useDropFiles } from './hooks/useDropFiles.ts'
import { useDocumentStore } from './state/documentStore.ts'
import { useWorkspaceStore } from './state/workspaceStore.ts'
import './styles/editor.css'

export default function App() {
  useHostEvents()
  useDocumentTitle()
  useDropFiles()

  const { sidebarVisible, sidebarWidth, focusMode, typewriterMode } = useWorkspaceStore()

  useEffect(() => {
    editorController.setModes({ focus: focusMode, typewriter: typewriterMode })
  }, [focusMode, typewriterMode])

  useEffect(() => {
    let timer: number | undefined
    return editorController.onDocChange((text) => {
      // Debounced: stats and the outline are cosmetic, and reparsing the tree
      // on every keystroke of a long document is wasted work.
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const state = editorController.getState()
        if (!state) return
        useWorkspaceStore.getState().setStats({
          words: countWords(text),
          chars: countChars(state),
        })
        useWorkspaceStore.getState().setOutline(extractOutline(state))
        // Undoing back to the saved text should clear the dot, so compare
        // content rather than tracking an edited flag.
        useDocumentStore.getState().setDirty(text !== useDocumentStore.getState().savedText)
      }, 200)
    })
  }, [])

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: sidebarVisible ? `${sidebarWidth}px 1fr` : '0 1fr' }}
    >
      <Titlebar />
      {sidebarVisible && <Sidebar />}
      <div className="main-pane">
        <Banner />
        <EditorPane />
        <StatusBar />
      </div>
    </div>
  )
}
