import { useCallback, useEffect, useRef, useState } from 'react'
import { TIMELINE_CONSTANTS } from '../constants'
import { getCumulativeHeightBefore } from '../trackUtils'
import { TRACK_HEIGHTS } from '../constants'
import type { AdaptedTrack } from '../types'
import {
  normalizeSelectionRect,
  rectsIntersect,
  type BoxSelectableItem,
  type SelectionRect,
} from '../../../../editor/selection/boxSelect'

const ACTIVATE_THRESHOLD_PX = 5

interface SelectionBoxState {
  startPos: { x: number; y: number }
  currentPos: { x: number; y: number }
  isActive: boolean
}

function getSelectionRectInContent({
  container,
  scrollContainer,
  startPos,
  endPos,
}: {
  container: HTMLElement
  scrollContainer: HTMLDivElement | null
  startPos: { x: number; y: number }
  endPos: { x: number; y: number }
}): SelectionRect {
  const containerRect = container.getBoundingClientRect()
  const scrollLeft = scrollContainer?.scrollLeft ?? 0
  const scrollTop = scrollContainer?.scrollTop ?? 0
  return normalizeSelectionRect(
    {
      x: startPos.x - containerRect.left + scrollLeft,
      y: startPos.y - containerRect.top + scrollTop,
    },
    {
      x: endPos.x - containerRect.left + scrollLeft,
      y: endPos.y - containerRect.top + scrollTop,
    }
  )
}

function resolveItemsInBox(tracks: AdaptedTrack[], box: SelectionRect, zoomLevel: number): BoxSelectableItem[] {
  const pixelsPerSecond = TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
  const items: BoxSelectableItem[] = []

  for (const [trackIndex, track] of tracks.entries()) {
    const trackTop = getCumulativeHeightBefore(tracks, trackIndex)
    const trackBottom = trackTop + TRACK_HEIGHTS[track.type]
    const elementRectBase = { top: trackTop, bottom: trackBottom }

    for (const element of track.elements) {
      const elementRect: SelectionRect = {
        left: element.startTime * pixelsPerSecond,
        right: (element.startTime + element.duration) * pixelsPerSecond,
        ...elementRectBase,
      }
      if (!rectsIntersect(box, elementRect)) continue

      if (element.source.kind === 'block') {
        items.push({ kind: 'block', id: element.source.blockId })
      } else if (element.source.kind === 'caption') {
        items.push({ kind: 'caption', id: element.source.blockId })
      } else if (element.source.kind === 'overlay') {
        items.push({ kind: 'overlay', id: element.source.overlayId })
      }
    }
  }

  return items
}

export function useTimelineBoxSelect(options: {
  tracksCanvasRef: React.RefObject<HTMLDivElement | null>
  tracksScrollRef: React.RefObject<HTMLDivElement | null>
  tracks: AdaptedTrack[]
  zoomLevel: number
  onSelectionComplete: (items: BoxSelectableItem[], additive: boolean) => void
  enabled?: boolean
}) {
  const {
    tracksCanvasRef,
    tracksScrollRef,
    tracks,
    zoomLevel,
    onSelectionComplete,
    enabled = true,
  } = options

  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null)
  const justFinishedRef = useRef(false)
  const additiveRef = useRef(false)

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!enabled || event.button !== 0) return
      const target = event.target as HTMLElement
      if (target.closest('.oc-timeline__element, .oc-timeline__playhead, .oc-timeline__bookmark, .oc-timeline__add-text')) {
        return
      }
      additiveRef.current = event.shiftKey || event.ctrlKey || event.metaKey
      setSelectionBox({
        startPos: { x: event.clientX, y: event.clientY },
        currentPos: { x: event.clientX, y: event.clientY },
        isActive: false,
      })
    },
    [enabled]
  )

  const selectInBox = useCallback(
    (startPos: { x: number; y: number }, endPos: { x: number; y: number }) => {
      const container = tracksCanvasRef.current
      if (!container) return
      const box = getSelectionRectInContent({
        container,
        scrollContainer: tracksScrollRef.current,
        startPos,
        endPos,
      })
      const items = resolveItemsInBox(tracks, box, zoomLevel)
      onSelectionComplete(items, additiveRef.current)
    },
    [tracks, tracksCanvasRef, tracksScrollRef, zoomLevel, onSelectionComplete]
  )

  useEffect(() => {
    if (!selectionBox) return

    const onMove = (event: MouseEvent) => {
      const deltaX = Math.abs(event.clientX - selectionBox.startPos.x)
      const deltaY = Math.abs(event.clientY - selectionBox.startPos.y)
      const isActive = selectionBox.isActive || deltaX > ACTIVATE_THRESHOLD_PX || deltaY > ACTIVATE_THRESHOLD_PX
      const next = {
        ...selectionBox,
        currentPos: { x: event.clientX, y: event.clientY },
        isActive,
      }
      setSelectionBox(next)
      if (isActive) {
        selectInBox(next.startPos, next.currentPos)
      }
    }

    const onUp = () => {
      if (selectionBox.isActive) {
        justFinishedRef.current = true
        requestAnimationFrame(() => {
          justFinishedRef.current = false
        })
      }
      setSelectionBox(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [selectionBox, selectInBox])

  const selectionBoxStyle =
    selectionBox?.isActive && tracksCanvasRef.current
      ? (() => {
          const container = tracksCanvasRef.current!
          const rect = container.getBoundingClientRect()
          const scrollLeft = tracksScrollRef.current?.scrollLeft ?? 0
          const scrollTop = tracksScrollRef.current?.scrollTop ?? 0
          const box = getSelectionRectInContent({
            container,
            scrollContainer: tracksScrollRef.current,
            startPos: selectionBox.startPos,
            endPos: selectionBox.currentPos,
          })
          return {
            left: box.left - scrollLeft,
            top: box.top - scrollTop,
            width: box.right - box.left,
            height: box.bottom - box.top,
          }
        })()
      : null

  const shouldIgnoreClick = useCallback(() => justFinishedRef.current, [])

  return {
    handleMouseDown,
    selectionBoxStyle,
    isSelecting: selectionBox?.isActive ?? false,
    shouldIgnoreClick,
  }
}
