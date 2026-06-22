import {
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { readTimelineZoomLevel, writeTimelineZoomLevel } from '../../../../utils/timelineZoomPrefs'
import { setSyncedTimelineScrollLeft } from './useHorizontalScrollSync'
import { TIMELINE_CONSTANTS } from '../constants'
import { zoomToSlider } from '../zoomUtils'

interface UseTimelineZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>
  minZoom: number
  playheadSec: number
  tracksScrollRef: RefObject<HTMLDivElement | null>
  horizontalScrollRef?: RefObject<HTMLDivElement | null>
  initialZoom?: number
  /** 剪辑 session id：用于记住 Ctrl+滚轮 / 滑条缩放 */
  persistenceKey?: string | null
}

function clampZoomLevel(value: number, minZoom: number): number {
  return Math.max(minZoom, Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, value))
}

export function useTimelineZoom({
  containerRef,
  minZoom,
  playheadSec,
  tracksScrollRef,
  horizontalScrollRef,
  initialZoom,
  persistenceKey = null,
}: UseTimelineZoomOptions) {
  const readPersistedZoom = useCallback(
    (key: string | null | undefined) => {
      if (!key) return null
      const stored = readTimelineZoomLevel(key)
      return stored == null ? null : clampZoomLevel(stored, minZoom)
    },
    [minZoom]
  )

  const [zoomLevel, setZoomLevelRaw] = useState(() =>
    clampZoomLevel(readPersistedZoom(persistenceKey) ?? initialZoom ?? 1, minZoom)
  )
  const previousZoomRef = useRef(zoomLevel)
  const preZoomScrollLeftRef = useRef(0)
  const skipPersistRef = useRef(true)

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
        return clampZoomLevel(nextZoom, minZoom)
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
    skipPersistRef.current = true
    const persisted = readPersistedZoom(persistenceKey)
    wrappedSetZoomLevel(persisted ?? initialZoom ?? 1)
  }, [persistenceKey, initialZoom, readPersistedZoom, wrappedSetZoomLevel])

  useEffect(() => {
    wrappedSetZoomLevel((prev) => (prev < minZoom ? minZoom : prev))
  }, [minZoom, wrappedSetZoomLevel])

  useEffect(() => {
    if (!persistenceKey) return
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      writeTimelineZoomLevel(persistenceKey, zoomLevel)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [persistenceKey, zoomLevel])

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
      const clampedScrollLeft = Math.max(0, Math.min(maxScrollLeft, newScrollLeft))
      if (horizontalScrollRef) {
        setSyncedTimelineScrollLeft(tracksScrollRef, horizontalScrollRef, clampedScrollLeft)
      } else {
        scrollElement.scrollLeft = clampedScrollLeft
      }
    }
    previousZoomRef.current = zoomLevel
  }, [zoomLevel, minZoom, playheadSec, tracksScrollRef, horizontalScrollRef])

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
