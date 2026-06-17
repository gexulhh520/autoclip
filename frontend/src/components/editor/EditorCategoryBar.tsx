import React from 'react'
import {
  ArrowRightLeft,
  Captions,
  Clapperboard,
  Music2,
  Settings,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Type,
  Zap,
} from 'lucide-react'
import {
  ASSETS_PANEL_TABS,
  type AssetsPanelTab,
  useAssetsPanelStore,
} from './opencut/useAssetsPanelStore'

const TAB_META: Record<
  AssetsPanelTab,
  { label: string; icon: React.ReactNode }
> = {
  media: { label: '素材', icon: <Clapperboard size={16} strokeWidth={1.75} /> },
  sfx: { label: '音效', icon: <Zap size={16} strokeWidth={1.75} /> },
  bgm: { label: 'BGM', icon: <Music2 size={16} strokeWidth={1.75} /> },
  text: { label: '文本', icon: <Type size={16} strokeWidth={1.75} /> },
  stickers: { label: '贴纸', icon: <Smile size={16} strokeWidth={1.75} /> },
  effects: { label: '效果', icon: <Sparkles size={16} strokeWidth={1.75} /> },
  transitions: { label: '转场', icon: <ArrowRightLeft size={16} strokeWidth={1.75} /> },
  captions: { label: '字幕', icon: <Captions size={16} strokeWidth={1.75} /> },
  adjustment: { label: '调节', icon: <SlidersHorizontal size={16} strokeWidth={1.75} /> },
  settings: { label: '设置', icon: <Settings size={16} strokeWidth={1.75} /> },
}

const EditorCategoryBar: React.FC = () => {
  const activeTab = useAssetsPanelStore((state) => state.activeTab)
  const setActiveTab = useAssetsPanelStore((state) => state.setActiveTab)

  return (
    <nav className="editor-category-bar oc-panel-tabbar" aria-label="素材分类">
      {ASSETS_PANEL_TABS.map((key) => {
        const tab = TAB_META[key]
        return (
          <button
            key={key}
            type="button"
            className={`oc-panel-tab editor-category-btn ${activeTab === key ? 'is-active' : ''}`}
            onClick={() => setActiveTab(key)}
            title={tab.label}
            aria-label={tab.label}
          >
            {tab.icon}
          </button>
        )
      })}
    </nav>
  )
}

export default EditorCategoryBar
