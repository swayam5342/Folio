import { create } from 'zustand'

import type { Source, StudyKind, ViewerTarget } from '../api/types'

/** Tabs of the right-hand pane. */
export type RightTab = 'viewer' | 'inspector' | 'citations'
/** Center pane modes. */
export type CenterMode = 'chat' | 'study'
/** Mobile bottom-bar tabs. */
export type MobileTab = 'sources' | 'chat' | 'side' | 'study'

/** Where a citation was clicked, so the viewer can draw a beam from it to the highlight. */
export type BeamOrigin = { x: number; y: number; nonce: number }

type StudyRequest = { kind: StudyKind; topic?: string; nonce: number }

type WorkspaceState = {
  notebookId: string | null
  center: CenterMode
  rightTab: RightTab
  rightOpen: boolean
  sourcesOpen: boolean
  mobileTab: MobileTab
  viewer: ViewerTarget | null
  /** Answer whose retrieval the Inspector and Citations tabs show; null = the latest answer. */
  inspectedId: string | null
  /** Sources unticked by the user (excluded from chat retrieval). */
  excluded: Set<string>
  paletteOpen: boolean
  beam: BeamOrigin | null
  studyRequest: StudyRequest | null
  /** Bumped to ask the composer to focus or the sources panel to open its file picker. */
  focusComposerNonce: number
  uploadNonce: number

  reset: (notebookId: string) => void
  setCenter: (center: CenterMode) => void
  setRightTab: (tab: RightTab) => void
  setRightOpen: (open: boolean) => void
  setSourcesOpen: (open: boolean) => void
  setMobileTab: (tab: MobileTab) => void
  openSource: (source: Pick<Source, 'document_id' | 'page_number' | 'snippet'>, origin?: { x: number; y: number }) => void
  openDocument: (documentId: string, page?: number) => void
  closeViewer: () => void
  inspect: (messageId: string | null, tab?: Exclude<RightTab, 'viewer'>) => void
  setExcluded: (excluded: Set<string>) => void
  setPaletteOpen: (open: boolean) => void
  requestStudy: (kind: StudyKind, topic?: string) => void
  focusComposer: () => void
  requestUpload: () => void
}

const initial = {
  center: 'chat' as CenterMode,
  rightTab: 'viewer' as RightTab,
  rightOpen: false,
  sourcesOpen: true,
  mobileTab: 'chat' as MobileTab,
  viewer: null,
  inspectedId: null,
  excluded: new Set<string>(),
  paletteOpen: false,
  beam: null,
  studyRequest: null,
  focusComposerNonce: 0,
  uploadNonce: 0,
}

/**
 * UI state of the open notebook's workspace, shared by its panes, the command
 * palette and the composer. `reset` runs whenever a different notebook opens.
 */
export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  notebookId: null,
  ...initial,

  reset: (notebookId) => {
    if (get().notebookId !== notebookId) set({ notebookId, ...initial, excluded: new Set() })
  },
  setCenter: (center) => set({ center, mobileTab: center }),
  setRightTab: (rightTab) => set({ rightTab, rightOpen: true, mobileTab: 'side' }),
  setRightOpen: (rightOpen) => set({ rightOpen }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
  setMobileTab: (mobileTab) =>
    set((s) => ({ mobileTab, center: mobileTab === 'chat' || mobileTab === 'study' ? mobileTab : s.center })),
  openSource: (source, origin) => {
    const nonce = Date.now()
    set({
      viewer: { documentId: source.document_id, page: source.page_number, snippet: source.snippet, nonce },
      rightTab: 'viewer',
      rightOpen: true,
      mobileTab: 'side',
      beam: origin ? { ...origin, nonce } : null,
    })
  },
  openDocument: (documentId, page = 1) =>
    set({ viewer: { documentId, page, nonce: Date.now() }, rightTab: 'viewer', rightOpen: true, mobileTab: 'side', beam: null }),
  closeViewer: () =>
    set((s) => ({ viewer: null, rightOpen: s.rightTab !== 'viewer', mobileTab: s.center })),
  inspect: (inspectedId, tab = 'inspector') => set({ inspectedId, rightTab: tab, rightOpen: true, mobileTab: 'side' }),
  setExcluded: (excluded) => set({ excluded }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  requestStudy: (kind, topic) =>
    set({ studyRequest: { kind, topic, nonce: Date.now() }, center: 'study', mobileTab: 'study' }),
  focusComposer: () => set((s) => ({ center: 'chat', mobileTab: 'chat', focusComposerNonce: s.focusComposerNonce + 1 })),
  requestUpload: () => set((s) => ({ uploadNonce: s.uploadNonce + 1, mobileTab: 'sources' })),
}))
