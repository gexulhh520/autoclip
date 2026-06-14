import React, { useMemo } from 'react'
import { formatRulerLabel, getRulerConfig, shouldShowLabel } from './rulerUtils'
import { TIMELINE_CONSTANTS } from './constants'
import { timeToPx } from './zoomUtils'

interface TimelineRulerProps {
  zoomLevel: number
  dynamicTimelineWidth: number
  duration: number
  fps: number
  paddingPx: number
  onWheel: (event: React.WheelEvent) => void
  onPointerDown: (event: React.MouseEvent) => void
  onClick: (event: React.MouseEvent) => void
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({
  zoomLevel,
  dynamicTimelineWidth,
  duration,
  fps,
  paddingPx,
  onWheel,
  onPointerDown,
  onClick,
}) => {
  const pixelsPerSecond = TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
  const visibleDuration = dynamicTimelineWidth / pixelsPerSecond
  const effectiveDuration = Math.max(duration, visibleDuration)
  const { labelIntervalSeconds, tickIntervalSeconds } = getRulerConfig(zoomLevel, fps)
  const tickCount = Math.ceil(effectiveDuration / tickIntervalSeconds) + 1

  const ticks = useMemo(() => {
    const items: React.ReactNode[] = []
    for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
      const time = tickIndex * tickIntervalSeconds
      if (time > effectiveDuration) break
      const left = paddingPx + timeToPx(time, zoomLevel)
      const showLabel = shouldShowLabel(time, labelIntervalSeconds)
      items.push(
        <div
          key={tickIndex}
          className={`oc-timeline__tick${showLabel ? ' has-label' : ''}`}
          style={{ left }}
        >
          {showLabel ? (
            <span className="oc-timeline__tick-label">{formatRulerLabel(time, fps)}</span>
          ) : null}
        </div>
      )
    }
    return items
  }, [tickCount, tickIntervalSeconds, effectiveDuration, zoomLevel, labelIntervalSeconds, fps, paddingPx])

  return (
    <div
      className="oc-timeline__ruler"
      style={{ width: dynamicTimelineWidth }}
      onWheel={onWheel}
      onMouseDown={onPointerDown}
      onClick={onClick}
    >
      {ticks}
    </div>
  )
}

export default TimelineRuler
