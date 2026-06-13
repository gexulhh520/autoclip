import React, { useState } from 'react'
import type { EditBlock } from '../../types/editSession'

interface EditorTimelineCaptionClipProps {
  block: EditBlock
  left: number
  width: number
  selected: boolean
  onSelect: (event: React.MouseEvent) => void
  onSave: (content: string) => void
}

const EditorTimelineCaptionClip: React.FC<EditorTimelineCaptionClipProps> = ({
  block,
  left,
  width,
  selected,
  onSelect,
  onSave,
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const caption =
    block.overlay.content[0] || block.overlay.outline || block.title || '字幕'
  const clipWidth = Math.max(width, 72)

  const startEdit = (event: React.MouseEvent) => {
    event.stopPropagation()
    setDraft(caption)
    setEditing(true)
  }

  const commitEdit = () => {
    const next = draft.trim()
    if (next && next !== caption) {
      onSave(next)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className="editor-caption-input"
        style={{ left, width: clipWidth }}
        value={draft}
        autoFocus
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitEdit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={`editor-srt-marker editor-srt-marker--caption ${selected ? 'is-selected' : ''}`}
      style={{ left, width: clipWidth }}
      title={`${caption}\n双击编辑字幕`}
      onClick={onSelect}
      onDoubleClick={startEdit}
    >
      {caption.slice(0, 14)}
    </button>
  )
}

export default EditorTimelineCaptionClip
