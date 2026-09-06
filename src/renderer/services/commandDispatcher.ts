import { editorController } from '../editor/editorController.ts'
import { useWorkspaceStore } from '../state/workspaceStore.ts'
import { api } from '../api.ts'
import type { EditorCommand, HostCommand } from '../../shared/ipc.ts'
import {
  closeDocument,
  newDocument,
  openFileDialog,
  openFolderDialog,
  revealInFinder,
  save,
  saveAs,
} from './fileOps.ts'

/** A native menu command arriving from main. */
export function dispatchHostCommand(command: HostCommand): void {
  if (command.startsWith('format:')) {
    editorController.exec(command.slice('format:'.length) as EditorCommand)
    return
  }

  if (command === 'edit:undo' || command === 'edit:redo') {
    const action = command === 'edit:undo' ? 'undo' : 'redo'
    // Sidebar and search fields need native undo; only take over when the
    // editor itself has focus.
    const active = document.activeElement
    const isField =
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    if (!editorController.hasFocus() && isField) {
      document.execCommand(action)
      return
    }
    editorController.exec(action)
    return
  }

  switch (command) {
    case 'file:new':
      void newDocument()
      return
    case 'file:open':
      void openFileDialog()
      return
    case 'file:openFolder':
      void openFolderDialog()
      return
    case 'file:save':
      void save()
      return
    case 'file:saveAs':
      void saveAs()
      return
    case 'file:close':
      void closeDocument()
      return
    case 'file:revealInFinder':
      void revealInFinder()
      return
    case 'view:toggleToolbar': {
      const store = useWorkspaceStore.getState()
      const next = !store.toolbarVisible
      store.setToolbarVisible(next)
      void api.settings.patch({ toolbarVisible: next })
      return
    }
    case 'view:toggleFocusMode': {
      useWorkspaceStore.getState().toggleFocusMode()
      return
    }
    case 'view:toggleTypewriterMode': {
      useWorkspaceStore.getState().toggleTypewriterMode()
      return
    }
    case 'view:toggleSidebar': {
      const store = useWorkspaceStore.getState()
      const next = !store.sidebarVisible
      store.setSidebarVisible(next)
      void api.settings.patch({ sidebar: { visible: next, width: store.sidebarWidth } })
      return
    }
    default:
      // Exhaustive in practice; an unknown command is simply ignored.
      return
  }
}
