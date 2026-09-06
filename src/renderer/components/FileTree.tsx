import { useEffect, useRef, useState } from 'react'
import { api, unwrapIpcError } from '../api.ts'
import { openPath, refreshFolder, renameFile, forgetTrashedFile } from '../services/fileOps.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { ChevronIcon, FileIcon } from './icons.tsx'
import type { FileNode } from '../../shared/api'

interface Props {
  node: FileNode
  depth: number
}

export default function FileTree({ node, depth }: Props) {
  const [open, setOpen] = useState(depth === 0)
  const [renaming, setRenaming] = useState(false)
  const currentPath = useDocumentStore((state) => state.filePath)
  const indent = { paddingLeft: `${depth * 12 + 8}px` }

  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    void api.menu
      .fileContext({ path: node.path, kind: node.kind })
      .then(async (result) => {
        if (result.action === 'rename') setRenaming(true)
        else if (result.action === 'trashed') {
          forgetTrashedFile(result.path)
          await refreshFolder()
        }
      })
      .catch((error: unknown) =>
        api.dialog.showError({ title: 'Could not open menu', message: unwrapIpcError(error) }),
      )
  }

  if (renaming) {
    return (
      <RenameRow
        node={node}
        style={indent}
        onDone={() => {
          setRenaming(false)
        }}
      />
    )
  }

  if (node.kind === 'file') {
    return (
      <button
        type="button"
        className={`tree-row tree-file${node.path === currentPath ? ' is-current' : ''}`}
        style={indent}
        onClick={() => void openPath(node.path)}
        onContextMenu={onContextMenu}
        title={node.path}
      >
        <FileIcon />
        <span className="tree-label">{node.name}</span>
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className="tree-row tree-dir"
        style={indent}
        onClick={() => setOpen((value) => !value)}
        onContextMenu={onContextMenu}
        aria-expanded={open}
      >
        <ChevronIcon open={open} />
        <span className="tree-label">{node.name}</span>
      </button>
      {open &&
        node.children?.map((child) => (
          <FileTree key={child.path} node={child} depth={depth + 1} />
        ))}
    </>
  )
}

/** In-place rename, the way Finder and VS Code do it. */
function RenameRow({
  node,
  style,
  onDone,
}: {
  node: FileNode
  style: React.CSSProperties
  onDone: () => void
}) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const field = input.current
    if (!field) return
    field.focus()
    // Select the stem, leaving the extension out of the selection.
    const dot = node.name.lastIndexOf('.')
    field.setSelectionRange(0, dot > 0 ? dot : node.name.length)
  }, [node.name])

  const commit = () => {
    const next = input.current?.value ?? ''
    if (next.trim() && next !== node.name) void renameFile(node.path, next)
    onDone()
  }

  return (
    <div className="tree-row tree-rename" style={style}>
      <FileIcon />
      <input
        ref={input}
        className="tree-rename-input"
        defaultValue={node.name}
        spellCheck={false}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onDone()
          }
        }}
      />
    </div>
  )
}
