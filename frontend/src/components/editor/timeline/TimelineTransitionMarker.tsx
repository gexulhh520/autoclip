import React from 'react'
import type { AdaptedTransitionMarker } from './types'
import { TRANSITION_OUT_LABELS } from '../../../types/transitions'
import { timeToPx } from './zoomUtils'

interface TimelineTransitionMarkerProps {
  marker: AdaptedTransitionMarker
  zoomLevel: number
}

const TimelineTransitionMarker: React.FC<TimelineTransitionMarkerProps> = ({
  marker,
  zoomLevel,
}) => {
  const width = Math.max(timeToPx(marker.durationSec, zoomLevel), 6)
  const left = timeToPx(marker.startSec, zoomLevel)

  return (
    <div
      className="oc-timeline__transition"
      style={{ left, width }}
      title={`${TRANSITION_OUT_LABELS[marker.kind]} · ${marker.durationSec.toFixed(2)}s`}
      aria-hidden
    >
      <span className="oc-timeline__transition-label">
        {TRANSITION_OUT_LABELS[marker.kind]}
      </span>
    </div>
  )
}

export default TimelineTransitionMarker
