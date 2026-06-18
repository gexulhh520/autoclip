import React from 'react'
import type { AdaptedElement, AdaptedTrack } from './types'
import { TRACK_COLORS } from './constants'
import { timeToPx } from './zoomUtils'

interface TimelineElementViewProps {
  element: AdaptedElement
  track: AdaptedTrack
  zoomLevel: number
  selected: boolean
  dragging?: boolean
  onSelect: (event: React.MouseEvent) => void
  onPointerDown: (event: React.PointerEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
  onResizeStart: (side: 'left' | 'right', event: React.PointerEvent) => void
  waveformPeaks?: number[]
}

const TimelineElementView: React.FC<TimelineElementViewProps> = ({
  element,
  track,
  zoomLevel,
  selected,
  dragging = false,
  onSelect,
  onPointerDown,
  onContextMenu,
  onResizeStart,
  waveformPeaks,
}) => {
  const width = Math.max(timeToPx(element.duration, zoomLevel), 24)
  const left = timeToPx(element.startTime, zoomLevel)
  const bgColor = track.type === 'video' ? undefined : TRACK_COLORS[track.type]

  return (
    <div
      className={`oc-timeline__element oc-timeline__element--${track.type}${
        selected ? ' is-selected' : ''
      }${dragging ? ' is-dragging' : ''}${element.hidden ? ' is-hidden' : ''}`}
      style={{ left, width, backgroundColor: bgColor }}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="oc-timeline__element-body"
        onPointerDown={(event) => {
          onSelect(event)
          onPointerDown(event)
        }}
      >
        {track.type === 'video' && element.source.kind === 'block' ? (
          <div
            className="oc-timeline__video-fill"
            style={{
              backgroundImage: element.source.videoUrl
                ? `url(${element.source.videoUrl})`
                : undefined,
            }}
          />
        ) : null}
        {track.type === 'video' && waveformPeaks && waveformPeaks.length > 0 ? (
          <div className="oc-timeline__waveform-inline" aria-hidden>
            {waveformPeaks.map((peak, index) => (
              <span
                key={index}
                className="oc-timeline__waveform-bar"
                style={{ height: `${Math.max(12, peak * 100)}%` }}
              />
            ))}
          </div>
        ) : null}
        {track.type !== 'video' ? (
          <span className="oc-timeline__element-label">
            {element.source.kind === 'caption' || element.source.kind === 'overlay'
              ? element.source.content
              : element.name}
          </span>
        ) : null}
        {track.type === 'audio' ? (
          <span className="oc-timeline__element-label">{element.name}</span>
        ) : null}
      </button>
      {selected ? (
        <>
          <div
            className="oc-timeline__resize oc-timeline__resize--left"
            onPointerDown={(event) => onResizeStart('left', event)}
          />
          <div
            className="oc-timeline__resize oc-timeline__resize--right"
            onPointerDown={(event) => onResizeStart('right', event)}
          />
        </>
      ) : null}
    </div>
  )
}

export default TimelineElementView
