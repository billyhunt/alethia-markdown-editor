import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'

export default function StatusBar() {
  const { filePath, dirty } = useDocumentStore()
  const { words, chars } = useWorkspaceStore()

  return (
    <footer className="statusbar">
      <span>
        {words.toLocaleString()} words · {chars.toLocaleString()} characters
      </span>
      <span className="statusbar-right">
        {documentName(filePath)}
        {dirty ? ' · unsaved' : ''}
      </span>
    </footer>
  )
}
