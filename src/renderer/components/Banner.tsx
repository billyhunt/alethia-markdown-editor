import { useWorkspaceStore } from '../state/workspaceStore.ts'

/** Non-modal notice for external changes and save conflicts. */
export default function Banner() {
  const notice = useWorkspaceStore((state) => state.notice)
  if (!notice) return null

  return (
    <div className="banner" role="status">
      <span>{notice.message}</span>
      <span className="banner-actions">
        {notice.actions.map((action) => (
          <button key={action.label} type="button" className="button" onClick={action.run}>
            {action.label}
          </button>
        ))}
      </span>
    </div>
  )
}
