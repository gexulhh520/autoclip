import {
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { readTimelineZoomLevel, writeTimelineZoomLevel } from '../../../../utils/timelineZoomPrefs'
import { TIMELINE_CONSTANTS } from '../constants'

interface UseTimelineZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>
  minZoom: number
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
  initialZoom,
  persistenceKey = null,
}: UseTimelineZoomOptions) {
  const minZoomRef = useRef(minZoom)
  minZoomRef.current = minZoom

  const [zoomLevel, setZoomLevelRaw] = useState(() => {
    const stored = persistenceKey ? readTimelineZoomLevel(persistenceKey) : null
    return clampZoomLevel(stored ?? initialZoom ?? 1, minZoom)
  })
  const skipPersistRef = useRef(true)

  const wrappedSetZoomLevel = useCallback(
    (zoomLevelOrUpdater: number | ((prev: number) => number)) => {
      setZoomLevelRaw((prev) => {
        const nextZoom =
          typeof zoomLevelOrUpdater === 'function'
            ? zoomLevelOrUpdater(prev)
            : zoomLevelOrUpdater
        return clampZoomLevel(nextZoom, minZoomRef.current)
      })
    },
    []
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
    if (!persistenceKey) {
      wrappedSetZoomLevel(initialZoom ?? 1)
      return
    }
    const stored = readTimelineZoomLevel(persistenceKey)
    wrappedSetZoomLevel(stored ?? initialZoom ?? 1)
  }, [persistenceKey, initialZoom, wrappedSetZoomLevel])

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
