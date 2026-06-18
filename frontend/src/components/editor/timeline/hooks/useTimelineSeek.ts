import { useCallback, useRef } from 'react'
import { TIMELINE_CONSTANTS } from '../constants'
import { pxToTime } from '../zoomUtils'

export function useTimelineSeek(options: {
  tracksScrollRef: React.RefObject<HTMLDivElement | null>
  zoomLevel: number
  duration: number
  onSeek: (timeSec: number) => void
  onClearSelection: () => void
}) {
  const { tracksScrollRef, zoomLevel, duration, onSeek, onClearSelection } = options
  const mouseTrackingRef = useRef({ isMouseDown: false, downX: 0, downY: 0, downTime: 0 })

  const seekFromClientX = useCallback(
    (clientX: number, scrollLeftOverride?: number) => {
      const scrollElement = tracksScrollRef.current
      if (!scrollElement) return
      const rect = scrollElement.getBoundingClientRect()
      const scrollLeft = scrollLeftOverride ?? scrollElement.scrollLeft
      const xInContent = clientX - rect.left + scrollLeft
      const time = Math.max(0, Math.min(duration, pxToTime(xInContent, zoomLevel)))
      onSeek(time)
    },
    [tracksScrollRef, zoomLevel, duration, onSeek]
  )

  const handlePointerDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return
    mouseTrackingRef.current = {
      isMouseDown: true,
      downX: event.clientX,
      downY: event.clientY,
      downTime: event.timeStamp,
    }
  }, [])

  const handlePointerClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.oc-timeline__element, .oc-timeline__playhead, .oc-timeline__bookmark')) {
        return
      }
      const { isMouseDown, downX, downY, downTime } = mouseTrackingRef.current
      if (!isMouseDown) return
      const deltaX = Math.abs(event.clientX - downX)
      const deltaY = Math.abs(event.clientY - downY)
      if (deltaX > 5 || deltaY > 5 || event.timeStamp - downTime > 500) return
      onClearSelection()
      seekFromClientX(event.clientX)
    },
    [onClearSelection, seekFromClientX]
  )

  /** 标尺 / 播放头：按下拖动即可 scrub（暂停时同步预览） */
  const startScrub = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      onClearSelection()
      seekFromClientX(event.clientX)

      const onMove = (moveEvent: PointerEvent) => {
        seekFromClientX(moveEvent.clientX)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [onClearSelection, seekFromClientX]
  )

  return { seekFromClientX, handlePointerDown, handlePointerClick, startScrub }
}

export function usePlayheadDrag(options: {
  seekFromClientX: (clientX: number) => void
}) {
  const { seekFromClientX } = options

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.stopPropagation()
      event.preventDefault()
      const handle = event.currentTarget as HTMLElement
      handle.setPointerCapture(event.pointerId)
      seekFromClientX(event.clientX)

      const onMove = (moveEvent: PointerEvent) => {
        seekFromClientX(moveEvent.clientX)
      }
      const onUp = (upEvent: PointerEvent) => {
        if (handle.hasPointerCapture(upEvent.pointerId)) {
          handle.releasePointerCapture(upEvent.pointerId)
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [seekFromClientX]
  )

  return { startDrag }
}
