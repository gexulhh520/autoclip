import React from 'react'
import { Slider } from '../../ui/slider'
import {
  Bookmark,
  Copy,
  Link2,
  Magnet,
  Minus,
  Plus,
  Scissors,
  Trash2,
  Undo2,
  Redo2,
  Unlink2,
  Anchor,
} from 'lucide-react'
import { TIMELINE_CONSTANTS } from './constants'
import { sliderToZoom, zoomToSlider } from './zoomUtils'

interface TimelineToolbarProps {
  zoomLevel: number
  minZoom: number
  onZoomChange: (zoom: number) => void
  snapEnabled: boolean
  rippleEnabled: boolean
  blockLinkEnabled: boolean
  onToggleSnap: () => void
  onToggleRipple: () => void
  onToggleBlockLink: () => void
  onSplit: () => void
  onDelete: () => void
  onCopy: () => void
  onPaste: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleBookmark: () => void
  bookmarkActive: boolean
  canSplit: boolean
  canDelete: boolean
  canCopy: boolean
  canPaste: boolean
  canUndo: boolean
  canRedo: boolean
}

const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  zoomLevel,
  minZoom,
  onZoomChange,
  snapEnabled,
  rippleEnabled,
  blockLinkEnabled,
  onToggleSnap,
  onToggleRipple,
  onToggleBlockLink,
  onSplit,
  onDelete,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  onToggleBookmark,
  bookmarkActive,
  canSplit,
  canDelete,
  canCopy,
  canPaste,
  canUndo,
  canRedo,
}) => {
  const handleZoom = (direction: 'in' | 'out') => {
    const next =
      direction === 'in'
        ? Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, zoomLevel * TIMELINE_CONSTANTS.ZOOM_BUTTON_FACTOR)
        : Math.max(minZoom, zoomLevel / TIMELINE_CONSTANTS.ZOOM_BUTTON_FACTOR)
    onZoomChange(next)
  }

  return (
    <div className="oc-timeline__toolbar">
      <div className="oc-timeline__toolbar-group">
        <ToolbarButton title="分割" disabled={!canSplit} onClick={onSplit}>
          <Scissors size={16} />
        </ToolbarButton>
        <ToolbarButton title="复制" disabled={!canCopy} onClick={onCopy}>
          <Copy size={16} />
        </ToolbarButton>
        <ToolbarButton title="粘贴" disabled={!canPaste} onClick={onPaste}>
          <Copy size={16} className="opacity-60" />
        </ToolbarButton>
        <ToolbarButton title="删除" disabled={!canDelete} onClick={onDelete}>
          <Trash2 size={16} />
        </ToolbarButton>
        <span className="oc-timeline__toolbar-divider" />
        <ToolbarButton title="撤销" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton title="重做" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={16} />
        </ToolbarButton>
        <ToolbarButton
          title={bookmarkActive ? '移除书签' : '添加书签'}
          active={bookmarkActive}
          onClick={onToggleBookmark}
        >
          <Bookmark size={16} />
        </ToolbarButton>
      </div>

      <div className="oc-timeline__toolbar-session">时间线</div>

      <div className="oc-timeline__toolbar-group">
        <ToolbarButton title="磁吸" active={snapEnabled} onClick={onToggleSnap}>
          <Magnet size={16} />
        </ToolbarButton>
        <ToolbarButton
          title={
            rippleEnabled
              ? '主轨磁吸：裁切时后续片段跟随移动（点击关闭）'
              : '主轨磁吸已关闭：裁切仅影响当前片段（点击开启）'
          }
          active={rippleEnabled}
          onClick={onToggleRipple}
        >
          <Link2 size={16} />
        </ToolbarButton>
        <ToolbarButton
          title={
            blockLinkEnabled
              ? '片段联动：尾部裁切时同步缩短归属文本/音效，入点裁切时随片段移动（点击关闭）'
              : '联动已关闭：文本/音效保持绝对时间与时长（点击开启）'
          }
          active={blockLinkEnabled}
          onClick={onToggleBlockLink}
        >
          {blockLinkEnabled ? <Anchor size={16} /> : <Unlink2 size={16} />}
        </ToolbarButton>
        <span className="oc-timeline__toolbar-divider" />
        <ToolbarButton title="缩小" onClick={() => handleZoom('out')}>
          <Minus size={16} />
        </ToolbarButton>
        <Slider
          className="oc-timeline__zoom-slider"
          value={[zoomToSlider(zoomLevel, minZoom)]}
          onValueChange={(values) => onZoomChange(sliderToZoom(values[0], minZoom))}
          min={0}
          max={1}
          step={0.005}
        />
        <ToolbarButton title="放大" onClick={() => handleZoom('in')}>
          <Plus size={16} />
        </ToolbarButton>
      </div>
    </div>
  )
}

function ToolbarButton({
  children,
  title,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      className={`oc-timeline__tool-btn${active ? ' is-active' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default TimelineToolbar
