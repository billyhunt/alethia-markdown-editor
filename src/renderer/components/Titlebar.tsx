import { api } from '../api.ts'
import { documentName, useDocumentStore } from '../state/documentStore.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import { SidebarIcon } from './icons.tsx'

export default function Titlebar() {
  const filePath = useDocumentStore((state) => state.filePath)
  const dirty = useDocumentStore((state) => state.dirty)
  const { sidebarVisible, sidebarWidth, setSidebarVisible } = useWorkspaceStore()

  const toggle = () => {
    const next = !sidebarVisible
    setSidebarVisible(next)
    void api.settings.patch({ sidebar: { visible: next, width: sidebarWidth } })
  }

  return (
    <div className="titlebar">
      {/* Offset clears the traffic lights, which macOS draws over our chrome. */}
      <button type="button" className="icon-button" onClick={toggle} title="Toggle sidebar">
        <SidebarIcon />
      </button>
      <span className="titlebar-name">
        {documentName(filePath)}
        {dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
      </span>
    </div>
  )
}
