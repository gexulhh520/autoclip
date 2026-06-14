import React from 'react'
import type { EditOverlayElement } from '../../types/editSession'
import { readStringParam } from '../../editor/opencut-text/params'
import { snapTime } from '../../utils/editTimeline'

interface EditorTimelineOverlayClipProps {
  element: EditOverlayElement
  left: number
  width: number
  selected: boolean
  pxPerSec: number
  snapEnabled: boolean
  snapPoints: number[]
  onSelect: (event: React.MouseEvent) => void
  onUpdate: (patch: Partial<EditOverlayElement>, recordHistory?: boolean) => void
}

const EditorTimelineOverlayClip: React.FC<EditorTimelineOverlayClipProps> = ({
  element,
  left,
  width,
  selected,
  pxPerSec,
  snapEnabled,
  snapPoints,
  onSelect,
  onUpdate,
}) => {
  const clipWidth = Math.max(width, 48)

  const startMoveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if ((event.target as HTMLElement).closest('.editor-block-trim')) return
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const initialStart = element.start_sec
    onUpdate({}, true)

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / pxPerSec
      const raw = Math.max(0, initialStart + deltaSec)
      const snapped = snapTime(raw, snapPoints, snapEnabled)
      onUpdate({ start_sec: snapped }, false)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startTrimDrag = (side: 'in' | 'out', event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const initialStart = element.start_sec
    const initialDuration = element.duration_sec
    onUpdate({}, true)

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / pxPerSec
      if (side === 'in') {
        const nextStart = Math.max(0, initialStart + deltaSec)
        const nextDuration = Math.max(0.2, initialDuration - (nextStart - initialStart))
        onUpdate({ start_sec: nextStart, duration_sec: nextDuration }, false)
      } else {
        const nextDuration = Math.max(0.2, initialDuration + deltaSec)
        onUpdate({ duration_sec: nextDuration }, false)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={`editor-overlay-wrap ${selected ? 'is-selected' : ''}`}
      style={{ left, width: clipWidth }}
    >
      <div
        className="editor-block-trim editor-block-trim--left"
        onPointerDown={(event) => startTrimDrag('in', event)}
      />
      <button
        type="button"
        className="editor-overlay-chip"
        onClick={onSelect}
        onPointerDown={startMoveDrag}
      >
        {readStringParam(element.params, 'content', '').slice(0, 16) || '文本'}
      </button>
      <div
        className="editor-block-trim editor-block-trim--right"
        onPointerDown={(event) => startTrimDrag('out', event)}
      />
    </div>
  )
}

export default EditorTimelineOverlayClip
