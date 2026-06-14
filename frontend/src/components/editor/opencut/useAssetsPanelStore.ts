import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const ASSETS_PANEL_TABS = [
  'media',
  'sounds',
  'text',
  'stickers',
  'effects',
  'transitions',
  'captions',
  'adjustment',
  'settings',
] as const

export type AssetsPanelTab = (typeof ASSETS_PANEL_TABS)[number]

interface AssetsPanelStore {
  activeTab: AssetsPanelTab
  setActiveTab: (tab: AssetsPanelTab) => void
}

export const useAssetsPanelStore = create<AssetsPanelStore>()(
  persist(
    (set) => ({
      activeTab: 'media',
      setActiveTab: (tab) => set({ activeTab: tab }),
    }),
    { name: 'autoclip-assets-panel' }
  )
)
