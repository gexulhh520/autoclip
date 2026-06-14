import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type EditorPanelId = 'tools' | 'preview' | 'properties' | 'mainContent' | 'timeline'

export const EDITOR_PANEL_DEFAULTS: Record<EditorPanelId, number> = {
  tools: 28,
  preview: 44,
  properties: 28,
  mainContent: 55,
  timeline: 45,
}

const PANEL_LIMITS: Record<EditorPanelId, { min: number; max: number }> = {
  tools: { min: 22, max: 40 },
  preview: { min: 30, max: 60 },
  properties: { min: 22, max: 40 },
  mainContent: { min: 38, max: 78 },
  timeline: { min: 22, max: 62 },
}

export function clampPanelSize(panel: EditorPanelId, size: number): number {
  const { min, max } = PANEL_LIMITS[panel]
  if (!Number.isFinite(size)) return EDITOR_PANEL_DEFAULTS[panel]
  return Math.max(min, Math.min(max, size))
}

export function normalizePanelSizes(
  input: Partial<Record<EditorPanelId, number>> | undefined
): Record<EditorPanelId, number> {
  const merged = { ...EDITOR_PANEL_DEFAULTS, ...input }
  return {
    tools: clampPanelSize('tools', merged.tools),
    preview: clampPanelSize('preview', merged.preview),
    properties: clampPanelSize('properties', merged.properties),
    mainContent: clampPanelSize('mainContent', merged.mainContent),
    timeline: clampPanelSize('timeline', merged.timeline),
  }
}

interface EditorPanelStore {
  panels: Record<EditorPanelId, number>
  setPanel: (panel: EditorPanelId, size: number) => void
  resetPanels: () => void
}

export const useEditorPanelStore = create<EditorPanelStore>()(
  persist(
    (set) => ({
      panels: { ...EDITOR_PANEL_DEFAULTS },
      setPanel: (panel, size) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panel]: clampPanelSize(panel, size),
          },
        })),
      resetPanels: () => set({ panels: { ...EDITOR_PANEL_DEFAULTS } }),
    }),
    {
      name: 'autoclip-editor-panel-sizes-v2',
      version: 1,
      migrate: (persisted: unknown) => {
        const state = persisted as { panels?: Partial<Record<EditorPanelId, number>> } | undefined
        return { panels: normalizePanelSizes(state?.panels) }
      },
    }
  )
)
