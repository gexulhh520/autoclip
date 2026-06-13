import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import EditorExportModal from './EditorExportModal'

interface EditorHeaderProps {
  projectId: string
}

const EditorHeader: React.FC<EditorHeaderProps> = ({ projectId }) => {
  const navigate = useNavigate()
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const dirty = useEditSessionStore((state) => state.dirty)
  const saveSession = useEditSessionStore((state) => state.saveSession)
  const updateSessionName = useEditSessionStore((state) => state.updateSessionName)
  const [exportOpen, setExportOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')

  const beginEditName = () => {
    setDraftName(session?.name || '未命名剪辑')
    setEditingName(true)
  }

  const commitEditName = () => {
    if (draftName.trim()) {
      updateSessionName(draftName.trim())
    }
    setEditingName(false)
  }

  return (
    <>
      <header className="editor-header">
        <div className="editor-header__left">
          <button
            type="button"
            className="editor-header__back"
            onClick={() => navigate('/')}
          >
            ← 返回桌面
          </button>
          {editingName ? (
            <input
              className="editor-header__title-input"
              value={draftName}
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitEditName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEditName()
                if (event.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <button type="button" className="editor-header__title-btn" onClick={beginEditName}>
              {session?.name || '剪辑工程'}
            </button>
          )}
          <span className="editor-status">
            {saving ? '保存中…' : dirty ? '有未保存更改' : '已保存'}
          </span>
        </div>
        <div className="editor-header__right">
          <button type="button" className="editor-header__back" onClick={() => saveSession(projectId)}>
            保存
          </button>
          <button
            type="button"
            className="editor-header__export"
            disabled={!session?.sequence.length}
            onClick={() => setExportOpen(true)}
          >
            导出
          </button>
        </div>
      </header>
      <EditorExportModal open={exportOpen} projectId={projectId} onClose={() => setExportOpen(false)} />
    </>
  )
}

export default EditorHeader
