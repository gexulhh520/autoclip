import React from 'react'
import type { AdaptedTransitionMarker } from './types'
import { TRANSITION_OUT_LABELS } from '../../../types/transitions'
import { timeToPx } from './zoomUtils'

interface TimelineTransitionMarkerProps {
  marker: AdaptedTransitionMarker
  zoomLevel: number
  selected?: boolean
  onSelect?: (fromBlockId: string) => void
  onContextMenu?: (fromBlockId: string, clientX: number, clientY: number) => void
  onInteractionStart?: () => void
}

const TimelineTransitionMarker: React.FC<TimelineTransitionMarkerProps> = ({
  marker,
  zoomLevel,
  selected = false,
  onSelect,
  onContextMenu,
  onInteractionStart,
}) => {
  const width = Math.max(timeToPx(marker.durationSec, zoomLevel), 6)
  const left = timeToPx(marker.startSec, zoomLevel)
  const label = TRANSITION_OUT_LABELS[marker.kind]

  return (
    <button
      type="button"
      className={`oc-timeline__transition${selected ? ' is-selected' : ''}`}
      style={{ left, width }}
      title={`${label} · ${marker.durationSec.toFixed(2)}s · 点击选中 · 右键删除`}
      aria-label={`${label}转场`}
      aria-pressed={selected}
      onPointerDown={(event) => {
        event.stopPropagation()
        onInteractionStart?.()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect?.(marker.fromBlockId)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onInteractionStart?.()
        onContextMenu?.(marker.fromBlockId, event.clientX, event.clientY)
      }}
    >
      <span className="oc-timeline__transition-label">{label}</span>
    </button>
  )
}

export default TimelineTransitionMarker
