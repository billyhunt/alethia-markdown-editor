import { useState } from 'react'
import { openPath } from '../services/fileOps.ts'
import { useDocumentStore } from '../state/documentStore.ts'
import { ChevronIcon, FileIcon } from './icons.tsx'
import type { FileNode } from '../../shared/api'

interface Props {
  node: FileNode
  depth: number
}

export default function FileTree({ node, depth }: Props) {
  const [open, setOpen] = useState(depth === 0)
  const currentPath = useDocumentStore((state) => state.filePath)
  const indent = { paddingLeft: `${depth * 12 + 8}px` }

  if (node.kind === 'file') {
    return (
      <button
        type="button"
        className={`tree-row tree-file${node.path === currentPath ? ' is-current' : ''}`}
        style={indent}
        onClick={() => void openPath(node.path)}
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
