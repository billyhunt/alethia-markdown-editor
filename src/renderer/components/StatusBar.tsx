import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'

export default function StatusBar() {
  const { filePath, dirty } = useDocumentStore()
  const { words, chars, focusMode, typewriterMode } = useWorkspaceStore()

  return (
    <footer className="statusbar">
      <span>
        {words.toLocaleString()} words · {chars.toLocaleString()} characters
      </span>
      <span className="statusbar-right">
        {focusMode && <span className="statusbar-badge">Focus</span>}
        {typewriterMode && <span className="statusbar-badge">Typewriter</span>}
        {documentName(filePath)}
        {dirty ? ' · unsaved' : ''}
      </span>
    </footer>
  )
}
