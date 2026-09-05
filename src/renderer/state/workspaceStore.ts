import { create } from 'zustand'
import type { FileNode, FolderTree } from '../../shared/api'

export interface OutlineEntry {
  level: number
  text: string
  pos: number
}

export interface WorkspaceState {
  folderRoot: string | null
  tree: FileNode | null
  truncated: boolean
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarTab: 'files' | 'outline'
  outline: OutlineEntry[]
  words: number
  chars: number
  /** Non-modal notice shown above the editor (external change, conflict). */
  notice: { message: string; actions: Array<{ label: string; run: () => void }> } | null

  setFolder: (folder: FolderTree | null) => void
  setSidebarVisible: (visible: boolean) => void
  setSidebarWidth: (width: number) => void
  setSidebarTab: (tab: 'files' | 'outline') => void
  setOutline: (outline: OutlineEntry[]) => void
  setStats: (stats: { words: number; chars: number }) => void
  setNotice: (notice: WorkspaceState['notice']) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  folderRoot: null,
  tree: null,
  truncated: false,
  sidebarVisible: true,
  sidebarWidth: 260,
  sidebarTab: 'files',
  outline: [],
  words: 0,
  chars: 0,
  notice: null,

  setFolder: (folder) =>
    set({
      folderRoot: folder?.root ?? null,
      tree: folder?.tree ?? null,
      truncated: folder?.truncated ?? false,
    }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setOutline: (outline) => set({ outline }),
  setStats: ({ words, chars }) => set({ words, chars }),
  setNotice: (notice) => set({ notice }),
}))
