import React from 'react'
import {
  Clapperboard,
  FileText,
  Music2,
  SlidersHorizontal,
  Type,
  Workflow,
} from 'lucide-react'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { EditorPanelMode } from '../../types/editSession'

const CATEGORIES: Array<{
  key: EditorPanelMode
  label: string
  icon: React.ReactNode
}> = [
  { key: 'media', label: '素材', icon: <Clapperboard size={16} strokeWidth={1.75} /> },
  { key: 'audio', label: '音频', icon: <Music2 size={16} strokeWidth={1.75} /> },
  { key: 'text', label: '文本', icon: <Type size={16} strokeWidth={1.75} /> },
  { key: 'transition', label: '转场', icon: <Workflow size={16} strokeWidth={1.75} /> },
  { key: 'adjust', label: '调节', icon: <SlidersHorizontal size={16} strokeWidth={1.75} /> },
  { key: 'draft', label: '草稿', icon: <FileText size={16} strokeWidth={1.75} /> },
]

const EditorCategoryBar: React.FC = () => {
  const editorPanelMode = useEditSessionStore((state) => state.editorPanelMode)
  const setEditorPanelMode = useEditSessionStore((state) => state.setEditorPanelMode)

  return (
    <nav className="editor-category-bar oc-panel-tabbar" aria-label="素材分类">
      {CATEGORIES.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`oc-panel-tab editor-category-btn ${editorPanelMode === item.key ? 'is-active' : ''}`}
          onClick={() => setEditorPanelMode(item.key)}
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  )
}

export default EditorCategoryBar
