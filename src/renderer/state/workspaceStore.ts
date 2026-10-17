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
  /** Workspace folders opened before, newest first. The vault switcher. */
  recentFolders: string[]
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarTab: 'files' | 'outline' | 'history'
  /** Whose history the panel shows; null means the open document. */
  historyTarget: string | null
  toolbarVisible: boolean
  autosave: boolean
  outline: OutlineEntry[]
  words: number
  chars: number
  focusMode: boolean
  typewriterMode: boolean
  /** Non-modal notice shown above the editor (external change, conflict). */
  notice: { message: string; actions: Array<{ label: string; run: () => void }> } | null

  setFolder: (folder: FolderTree | null) => void
  setRecentFolders: (folders: string[]) => void
  setSidebarVisible: (visible: boolean) => void
  setSidebarWidth: (width: number) => void
  setSidebarTab: (tab: 'files' | 'outline' | 'history') => void
  showHistoryFor: (path: string | null) => void
  setToolbarVisible: (visible: boolean) => void
  setAutosave: (autosave: boolean) => void
  setOutline: (outline: OutlineEntry[]) => void
  setStats: (stats: { words: number; chars: number }) => void
  setNotice: (notice: WorkspaceState['notice']) => void
  toggleFocusMode: () => void
  toggleTypewriterMode: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  folderRoot: null,
  tree: null,
  truncated: false,
  recentFolders: [],
  sidebarVisible: true,
  sidebarWidth: 260,
  sidebarTab: 'files',
  historyTarget: null,
  toolbarVisible: true,
  autosave: true,
  outline: [],
  words: 0,
  chars: 0,
  focusMode: false,
  typewriterMode: false,
  notice: null,

  setFolder: (folder) =>
    set({
      folderRoot: folder?.root ?? null,
      tree: folder?.tree ?? null,
      truncated: folder?.truncated ?? false,
    }),
  setRecentFolders: (recentFolders) => set({ recentFolders }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  showHistoryFor: (historyTarget) => set({ historyTarget, sidebarTab: 'history' }),
  setToolbarVisible: (toolbarVisible) => set({ toolbarVisible }),
  setAutosave: (autosave) => set({ autosave }),
  setOutline: (outline) => set({ outline }),
  setStats: ({ words, chars }) => set({ words, chars }),
  setNotice: (notice) => set({ notice }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  toggleTypewriterMode: () => set((state) => ({ typewriterMode: !state.typewriterMode })),
}))
