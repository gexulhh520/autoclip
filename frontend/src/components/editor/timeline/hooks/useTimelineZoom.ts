import {
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { TIMELINE_CONSTANTS } from '../constants'
import { zoomToSlider } from '../zoomUtils'

interface UseTimelineZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>
  minZoom: number
  playheadSec: number
  tracksScrollRef: RefObject<HTMLDivElement | null>
  initialZoom?: number
}

export function useTimelineZoom({
  containerRef,
  minZoom,
  playheadSec,
  tracksScrollRef,
  initialZoom,
}: UseTimelineZoomOptions) {
  const [zoomLevel, setZoomLevelRaw] = useState(() =>
    Math.max(minZoom, Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, initialZoom ?? 1))
  )
  const previousZoomRef = useRef(zoomLevel)
  const preZoomScrollLeftRef = useRef(0)

  const setZoomLevel = useCallback(
    (updater: number | ((prev: number) => number)) => {
      const scrollElement = tracksScrollRef.current
      if (scrollElement) preZoomScrollLeftRef.current = scrollElement.scrollLeft
      setZoomLevelRaw(updater)
    },
    [tracksScrollRef]
  )

  const wrappedSetZoomLevel = useCallback(
    (zoomLevelOrUpdater: number | ((prev: number) => number)) => {
      setZoomLevel((prev) => {
        const nextZoom =
          typeof zoomLevelOrUpdater === 'function'
            ? zoomLevelOrUpdater(prev)
            : zoomLevelOrUpdater
        return Math.max(minZoom, Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, nextZoom))
      })
    },
    [minZoom, setZoomLevel]
  )

  const handleWheel = useCallback(
    (event: ReactWheelEvent) => {
      const isZoomGesture = event.ctrlKey || event.metaKey
      const isHorizontalScrollGesture =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (isHorizontalScrollGesture || !isZoomGesture) return
      event.preventDefault()
      const zoomMultiplier = event.deltaY > 0 ? 1 / 1.1 : 1.1
      wrappedSetZoomLevel((prev) => prev * zoomMultiplier)
    },
    [wrappedSetZoomLevel]
  )

  useEffect(() => {
    wrappedSetZoomLevel((prev) => (prev < minZoom ? minZoom : prev))
  }, [minZoom, wrappedSetZoomLevel])

  useLayoutEffect(() => {
    const previousZoom = previousZoomRef.current
    if (previousZoom === zoomLevel) return
    const scrollElement = tracksScrollRef.current
    if (!scrollElement) {
      previousZoomRef.current = zoomLevel
      return
    }

    const currentScrollLeft = preZoomScrollLeftRef.current
    const sliderPercent = zoomToSlider(zoomLevel, minZoom)
    if (sliderPercent >= TIMELINE_CONSTANTS.ZOOM_ANCHOR_PLAYHEAD_THRESHOLD) {
      const playheadPixelsBefore =
        playheadSec * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * previousZoom
      const playheadPixelsAfter =
        playheadSec * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
      const viewportOffset = playheadPixelsBefore - currentScrollLeft
      const newScrollLeft = playheadPixelsAfter - viewportOffset
      const maxScrollLeft = scrollElement.scrollWidth - scrollElement.clientWidth
      scrollElement.scrollLeft = Math.max(0, Math.min(maxScrollLeft, newScrollLeft))
    }
    previousZoomRef.current = zoomLevel
  }, [zoomLevel, minZoom, playheadSec, tracksScrollRef])

  useEffect(() => {
    const preventZoom = (event: WheelEvent) => {
      if ((event.ctrlKey || event.metaKey) && containerRef.current?.contains(event.target as Node)) {
        event.preventDefault()
      }
    }
    document.addEventListener('wheel', preventZoom, { passive: false, capture: true })
    return () => document.removeEventListener('wheel', preventZoom, { capture: true })
  }, [containerRef])

  return { zoomLevel, setZoomLevel: wrappedSetZoomLevel, handleWheel }
}
