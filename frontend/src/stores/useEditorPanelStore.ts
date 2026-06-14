import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type EditorPanelId = 'tools' | 'preview' | 'properties' | 'mainContent' | 'timeline'

export const EDITOR_PANEL_DEFAULTS: Record<EditorPanelId, number> = {
  tools: 25,
  preview: 50,
  properties: 25,
  mainContent: 50,
  timeline: 50,
}

interface EditorPanelStore {
  panels: Record<EditorPanelId, number>
  setPanel: (panel: EditorPanelId, size: number) => void
}

export const useEditorPanelStore = create<EditorPanelStore>()(
  persist(
    (set) => ({
      panels: { ...EDITOR_PANEL_DEFAULTS },
      setPanel: (panel, size) =>
        set((state) => ({
          panels: { ...state.panels, [panel]: size },
        })),
    }),
    { name: 'autoclip-editor-panel-sizes' }
  )
)
