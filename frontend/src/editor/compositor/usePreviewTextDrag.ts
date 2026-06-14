import { useCallback, useRef } from 'react'
import type { EditSession } from '../../types/editSession'
import { readNumberParam } from '../opencut-text/params'
import type { FrameDescriptor } from './types'
import { canvasPointFromEvent, hitTestFrameDescriptor } from './hitTest'

const DRAG_THRESHOLD_PX = 4

interface DragState {
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
  overlayIds: string[]
  startPositions: Map<string, { positionX: number; positionY: number }>
}

export interface UsePreviewTextDragOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  descriptor: FrameDescriptor | null
  session: EditSession | null
  selectedOverlayIds: string[]
  onSelectOverlay?: (
    overlayId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean }
  ) => void
  beginOverlayDragHistory: () => void
  moveOverlayPositions: (
    updates: Array<{ elementId: string; positionX: number; positionY: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  beginOverlayDragHistory: () => void
}

export function usePreviewTextDrag({
  canvasRef,
  descriptor,
  session,
  selectedOverlayIds,
  onSelectOverlay,
  beginOverlayDragHistory,
  moveOverlayPositions,
}: UsePreviewTextDragOptions) {
  const dragRef = useRef<DragState | null>(null)

  const readOverlayPosition = useCallback(
    (elementId: string): { positionX: number; positionY: number } | null => {
      const element = session?.overlay_elements?.find((item) => item.id === elementId)
      if (!element?.params) return null
      return {
        positionX: readNumberParam(element.params, 'transform.positionX', 0),
        positionY: readNumberParam(element.params, 'transform.positionY', 0),
      }
    },
    [session]
  )

  const resolveDragTargets = useCallback(
    (hitElementId: string): string[] => {
      if (selectedOverlayIds.includes(hitElementId) && selectedOverlayIds.length > 0) {
        return selectedOverlayIds
      }
      return [hitElementId]
    },
    [selectedOverlayIds]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!descriptor || !session || event.button !== 0) return
      const canvas = canvasRef.current
      if (!canvas) return
      const { x, y } = canvasPointFromEvent(canvas, event)
      const hit = hitTestFrameDescriptor(descriptor, x, y)
      if (!hit?.elementId) return

      event.preventDefault()
      canvas.setPointerCapture(event.pointerId)

      const overlayIds = resolveDragTargets(hit.elementId)
      const startPositions = new Map<string, { positionX: number; positionY: number }>()
      for (const id of overlayIds) {
        const position = readOverlayPosition(id)
        if (position) startPositions.set(id, position)
      }
      if (startPositions.size === 0) return

      if (!selectedOverlayIds.includes(hit.elementId)) {
        onSelectOverlay?.(hit.elementId, {
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
          seekPlayhead: false,
        })
      }

      dragRef.current = {
        pointerId: event.pointerId,
        startX: x,
        startY: y,
        dragging: false,
        overlayIds,
        startPositions,
      }
    },
    [
      canvasRef,
      descriptor,
      onSelectOverlay,
      readOverlayPosition,
      resolveDragTargets,
      selectedOverlayIds,
      session,
    ]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      const canvas = canvasRef.current
      if (!canvas) return
      const { x, y } = canvasPointFromEvent(canvas, event)
      const dx = x - drag.startX
      const dy = y - drag.startY

      if (!drag.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        drag.dragging = true
        beginOverlayDragHistory()
      }

      const updates = drag.overlayIds.flatMap((elementId) => {
        const start = drag.startPositions.get(elementId)
        if (!start) return []
        return [
          {
            elementId,
            positionX: start.positionX + dx,
            positionY: start.positionY + dy,
          },
        ]
      })
      moveOverlayPositions(updates, { recordHistory: false })
    },
    [beginOverlayDragHistory, canvasRef, moveOverlayPositions]
  )

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      const canvas = canvasRef.current
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }

      if (!drag.dragging) {
        const hitTarget = drag.overlayIds[0] ?? null
        onSelectOverlay?.(hitTarget, {
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
          seekPlayhead: false,
        })
      }

      dragRef.current = null
    },
    [canvasRef, onSelectOverlay]
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      finishDrag(event)
    },
    [finishDrag]
  )

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      finishDrag(event)
    },
    [finishDrag]
  )

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  }
}
