import React from 'react'
import type { AdaptedTransitionMarker } from './types'
import { TRANSITION_OUT_LABELS } from '../../../types/transitions'
import { timeToPx } from './zoomUtils'

interface TimelineTransitionMarkerProps {
  marker: AdaptedTransitionMarker
  zoomLevel: number
  onRemove?: (fromBlockId: string) => void
  onInteractionStart?: () => void
}

const TimelineTransitionMarker: React.FC<TimelineTransitionMarkerProps> = ({
  marker,
  zoomLevel,
  onRemove,
  onInteractionStart,
}) => {
  const width = Math.max(timeToPx(marker.durationSec, zoomLevel), 6)
  const left = timeToPx(marker.startSec, zoomLevel)
  const label = TRANSITION_OUT_LABELS[marker.kind]

  return (
    <button
      type="button"
      className="oc-timeline__transition"
      style={{ left, width }}
      title={`${label} · ${marker.durationSec.toFixed(2)}s · 点击删除转场`}
      aria-label={`删除${label}转场`}
      onPointerDown={(event) => {
        event.stopPropagation()
        onInteractionStart?.()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onRemove?.(marker.fromBlockId)
      }}
    >
      <span className="oc-timeline__transition-label">{label}</span>
    </button>
  )
}

export default TimelineTransitionMarker
