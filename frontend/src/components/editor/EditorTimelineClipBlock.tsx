import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { EditBlock } from '../../types/editSession'
import { snapTime } from '../../utils/editTimeline'

export interface EditorTimelineClipBlockProps {
  block: EditBlock
  width: number
  left: number
  selected: boolean
  pxPerSec: number
  snapEnabled: boolean
  trimSnapPoints: number[]
  dissolveOutSec: number
  videoUrl: string
  onSelect: (event: React.MouseEvent) => void
}

const EditorTimelineClipBlock: React.FC<EditorTimelineClipBlockProps> = ({
  block,
  width,
  left,
  selected,
  pxPerSec,
  snapEnabled,
  trimSnapPoints,
  dissolveOutSec,
  videoUrl,
  onSelect,
}) => {
  const updateBlockTrim = useEditSessionStore((state) => state.updateBlockTrim)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })

  const blockWidth = Math.max(width, 72)
  const maxDur = block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)
  const hasDissolve = dissolveOutSec > 0.05

  const startTrimDrag = (side: 'in' | 'out', event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const initialIn = block.trim.in_sec
    const initialOut = block.trim.out_sec
    updateBlockTrim(
      block.id,
      { in_sec: block.trim.in_sec, out_sec: block.trim.out_sec },
      { recordHistory: true }
    )

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / pxPerSec
      if (side === 'in') {
        const raw = Math.max(0, Math.min(initialIn + deltaSec, initialOut - 0.1))
        const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
        updateBlockTrim(
          block.id,
          { in_sec: Math.max(0, Math.min(snapped, initialOut - 0.1)) },
          { recordHistory: false }
        )
      } else {
        const raw = Math.min(maxDur, Math.max(initialOut + deltaSec, initialIn + 0.1))
        const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
        updateBlockTrim(
          block.id,
          { out_sec: Math.min(maxDur, Math.max(snapped, initialIn + 0.1)) },
          { recordHistory: false }
        )
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    left,
    width: blockWidth,
    opacity: isDragging ? 0.82 : 1,
    zIndex: isDragging ? 4 : selected ? 3 : 2,
  }

  return (
    <div
      ref={setNodeRef}
      className={`editor-block-wrap ${selected ? 'is-selected' : ''}${hasDissolve ? ' is-dissolve-out' : ''}`}
      style={style}
    >
      <div
        className="editor-block-trim editor-block-trim--left"
        onPointerDown={(event) => startTrimDrag('in', event)}
      />
      <button
        type="button"
        className="editor-block editor-block--clip"
        onClick={onSelect}
        {...attributes}
        {...listeners}
      >
        <video
          className="editor-block__thumb"
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
        />
        <span className="editor-block__label">{block.title}</span>
        {hasDissolve ? <span className="editor-block__dissolve-tag">叠化</span> : null}
      </button>
      <div
        className="editor-block-trim editor-block-trim--right"
        onPointerDown={(event) => startTrimDrag('out', event)}
      />
    </div>
  )
}

export default EditorTimelineClipBlock
