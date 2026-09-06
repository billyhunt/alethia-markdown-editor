import { editorController } from '../editor/editorController.ts'
import { openFolderDialog } from '../services/fileOps.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import FileTree from './FileTree.tsx'
import History from './History.tsx'

export default function Sidebar() {
  const { tree, truncated, sidebarTab, outline, setSidebarTab } = useWorkspaceStore()

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          type="button"
          className={sidebarTab === 'files' ? 'is-active' : ''}
          onClick={() => setSidebarTab('files')}
        >
          Files
        </button>
        <button
          type="button"
          className={sidebarTab === 'outline' ? 'is-active' : ''}
          onClick={() => setSidebarTab('outline')}
        >
          Outline
        </button>
        <button
          type="button"
          className={sidebarTab === 'history' ? 'is-active' : ''}
          onClick={() => setSidebarTab('history')}
        >
          History
        </button>
      </div>

      <div className="sidebar-body">
        {sidebarTab === 'history' ? (
          <History />
        ) : sidebarTab === 'files' ? (
          tree ? (
            <>
              <FileTree node={tree} depth={0} />
              {truncated && <p className="sidebar-empty">Folder is large; some files are hidden.</p>}
            </>
          ) : (
            <div className="sidebar-empty">
              <p>No folder open.</p>
              <button type="button" className="button" onClick={() => void openFolderDialog()}>
                Open Folder…
              </button>
            </div>
          )
        ) : outline.length > 0 ? (
          outline.map((entry) => (
            <button
              key={`${entry.pos}-${entry.text}`}
              type="button"
              className="tree-row outline-row"
              style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
              onClick={() => editorController.scrollToPos(entry.pos)}
            >
              <span className="tree-label">{entry.text}</span>
            </button>
          ))
        ) : (
          <p className="sidebar-empty">No headings yet.</p>
        )}
      </div>
    </aside>
  )
}
