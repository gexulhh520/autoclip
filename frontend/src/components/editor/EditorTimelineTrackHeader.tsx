import React from 'react'

interface EditorTimelineTrackHeaderProps {
  label: string
  subLabel?: string
  collapsed?: boolean
  muted?: boolean
  onToggleCollapse?: () => void
  onToggleMute?: () => void
}

const EditorTimelineTrackHeader: React.FC<EditorTimelineTrackHeaderProps> = ({
  label,
  subLabel,
  collapsed = false,
  muted = false,
  onToggleCollapse,
  onToggleMute,
}) => (
  <div className="editor-track-header">
    <button
      type="button"
      className="editor-track-header__collapse"
      onClick={onToggleCollapse}
      title={collapsed ? '展开轨道' : '折叠轨道'}
      aria-expanded={!collapsed}
    >
      {collapsed ? '▸' : '▾'}
    </button>
    <div className="editor-track-header__labels">
      <span className="editor-track-header__name">{label}</span>
      {subLabel ? <span className="editor-track-header__sub">{subLabel}</span> : null}
    </div>
    {onToggleMute ? (
      <button
        type="button"
        className={`editor-track-header__mute ${muted ? 'is-muted' : ''}`}
        onClick={onToggleMute}
        title={muted ? '取消静音' : '静音'}
      >
        {muted ? '⊘' : '♪'}
      </button>
    ) : (
      <span className="editor-track-header__spacer" />
    )}
  </div>
)

export default EditorTimelineTrackHeader
