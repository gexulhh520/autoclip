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
import { TIMELINE_CONSTANTS } from '../constants'
import { getScrollLeftToCenterPlayhead } from '../zoomUtils'

interface UseTimelineZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>
  minZoom: number
  playheadSec: number
  tracksScrollRef: RefObject<HTMLDivElement | null>
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
  const skipPersistRef = useRef(true)

  const wrappedSetZoomLevel = useCallback(
    (zoomLevelOrUpdater: number | ((prev: number) => number)) => {
      setZoomLevelRaw((prev) => {
        const nextZoom =
          typeof zoomLevelOrUpdater === 'function'
            ? zoomLevelOrUpdater(prev)
            : zoomLevelOrUpdater
        return clampZoomLevel(nextZoom, minZoom)
      })
    },
    [minZoom]
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

    const maxScrollLeft = scrollElement.scrollWidth - scrollElement.clientWidth
    scrollElement.scrollLeft = getScrollLeftToCenterPlayhead(
      playheadSec,
      zoomLevel,
      scrollElement.clientWidth,
      maxScrollLeft
    )
    previousZoomRef.current = zoomLevel
  }, [zoomLevel, playheadSec, tracksScrollRef])

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
