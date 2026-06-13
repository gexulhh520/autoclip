import React from 'react'

interface EditorTimelineTransitionHandleProps {
  left: number
  kind: 'cut' | 'dissolve'
  disabled?: boolean
  onToggle: () => void
  onOpenInspector: () => void
}

const EditorTimelineTransitionHandle: React.FC<EditorTimelineTransitionHandleProps> = ({
  left,
  kind,
  disabled,
  onToggle,
  onOpenInspector,
}) => (
  <button
    type="button"
    className={`editor-transition-handle ${kind === 'dissolve' ? 'is-dissolve' : 'is-cut'}`}
    style={{ left }}
    disabled={disabled}
    title={kind === 'dissolve' ? '叠化转场（点击切换）' : '硬切（点击添加叠化）'}
    onClick={(event) => {
      event.stopPropagation()
      onToggle()
    }}
    onDoubleClick={(event) => {
      event.stopPropagation()
      onOpenInspector()
    }}
  >
    {kind === 'dissolve' ? '◆' : '|'}
  </button>
)

export default EditorTimelineTransitionHandle
