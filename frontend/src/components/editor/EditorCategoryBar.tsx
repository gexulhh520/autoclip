import React from 'react'
import {
  AppstoreOutlined,
  CustomerServiceOutlined,
  FontSizeOutlined,
  SwapOutlined,
  ControlOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { EditorPanelMode } from '../../types/editSession'

const CATEGORIES: Array<{ key: EditorPanelMode; label: string; icon: React.ReactNode }> = [
  { key: 'media', label: '素材', icon: <AppstoreOutlined /> },
  { key: 'audio', label: '音频', icon: <CustomerServiceOutlined /> },
  { key: 'text', label: '文本', icon: <FontSizeOutlined /> },
  { key: 'transition', label: '转场', icon: <SwapOutlined /> },
  { key: 'adjust', label: '调节', icon: <ControlOutlined /> },
  { key: 'draft', label: '草稿', icon: <FileTextOutlined /> },
]

const EditorCategoryBar: React.FC = () => {
  const editorPanelMode = useEditSessionStore((state) => state.editorPanelMode)
  const setEditorPanelMode = useEditSessionStore((state) => state.setEditorPanelMode)

  return (
    <div className="editor-category-bar">
      {CATEGORIES.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`editor-category-btn ${editorPanelMode === item.key ? 'is-active' : ''}`}
          onClick={() => setEditorPanelMode(item.key)}
          title={item.label}
        >
          <span className="editor-category-btn__icon">{item.icon}</span>
          <span className="editor-category-btn__label">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

export default EditorCategoryBar
