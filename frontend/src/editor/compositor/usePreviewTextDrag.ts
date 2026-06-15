import { useCallback, useRef, useState } from 'react'
import type { BoxSelectableItem } from '../selection/boxSelect'
import { normalizeSelectionRect } from '../selection/boxSelect'
import type { EditSession } from '../../types/editSession'
import { readNumberParam } from '../opencut-text/params'
import type { FrameDescriptor } from './types'
import {
  canvasPointFromEvent,
  hitTestFrameDescriptor,
  parseTextElementId,
  resolveBoxSelectionItems,
} from './hitTest'

const DRAG_THRESHOLD_PX = 4

interface OverlayDragState {
  mode: 'overlay'
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
  overlayIds: string[]
  startPositions: Map<string, { positionX: number; positionY: number }>
}

interface CaptionDragState {
  mode: 'caption'
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
  blockIds: string[]
  startOffsets: Map<string, { xPct: number; yPct: number }>
}

interface BoxSelectState {
  mode: 'box'
  pointerId: number
  startX: number
  startY: number
  active: boolean
  additive: boolean
}

type InteractionState = OverlayDragState | CaptionDragState | BoxSelectState

export interface PreviewSelectionBoxStyle {
  left: number
  top: number
  width: number
  height: number
}

export interface UsePreviewTextDragOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  descriptor: FrameDescriptor | null
  session: EditSession | null
  selectedOverlayIds: string[]
  selectedCaptionBlockIds: string[]
  onSelectOverlay?: (
    overlayId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean }
  ) => void
  onSelectCaption?: (blockId: string | null, options?: { additive?: boolean }) => void
  setBoxSelection?: (items: BoxSelectableItem[], options?: { additive?: boolean }) => void
  clearEditorSelection?: () => void
  beginOverlayDragHistory: () => void
  moveOverlayPositions: (
    updates: Array<{ elementId: string; positionX: number; positionY: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  moveCaptionOffsets: (
    updates: Array<{ blockId: string; position_offset_x_pct: number; position_offset_y_pct: number }>,
    options?: { recordHistory?: boolean }
  ) => void
}

const canvasRectToOverlayStyle = (
  canvas: HTMLCanvasElement,
  box: { left: number; top: number; right: number; bottom: number }
): PreviewSelectionBoxStyle => {
  const canvasRect = canvas.getBoundingClientRect()
  const parentRect = canvas.parentElement?.getBoundingClientRect() ?? canvasRect
  const scaleX = canvasRect.width / canvas.width
  const scaleY = canvasRect.height / canvas.height
  return {
    left: canvasRect.left - parentRect.left + box.left * scaleX,
    top: canvasRect.top - parentRect.top + box.top * scaleY,
    width: (box.right - box.left) * scaleX,
    height: (box.bottom - box.top) * scaleY,
  }
}

export function usePreviewTextDrag({
  canvasRef,
  descriptor,
  session,
  selectedOverlayIds,
  selectedCaptionBlockIds,
  onSelectOverlay,
  onSelectCaption,
  setBoxSelection,
  clearEditorSelection,
  beginOverlayDragHistory,
  moveOverlayPositions,
  moveCaptionOffsets,
}: UsePreviewTextDragOptions) {
  const dragRef = useRef<InteractionState | null>(null)
  const [selectionBoxStyle, setSelectionBoxStyle] = useState<PreviewSelectionBoxStyle | null>(null)

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

  const readCaptionOffset = useCallback(
    (blockId: string): { xPct: number; yPct: number } | null => {
      const block = session?.sequence.find((item) => item.id === blockId)
      if (!block?.overlay) return null
      return {
        xPct: Number(block.overlay.position_offset_x_pct ?? 0),
        yPct: Number(block.overlay.position_offset_y_pct ?? 0),
      }
    },
    [session]
  )

  const resolveOverlayDragTargets = useCallback(
    (hitElementId: string): string[] => {
      if (selectedOverlayIds.includes(hitElementId) && selectedOverlayIds.length > 0) {
        return selectedOverlayIds
      }
      return [hitElementId]
    },
    [selectedOverlayIds]
  )

  const resolveCaptionDragTargets = useCallback(
    (blockId: string): string[] => {
      if (selectedCaptionBlockIds.includes(blockId) && selectedCaptionBlockIds.length > 0) {
        return selectedCaptionBlockIds
      }
      return [blockId]
    },
    [selectedCaptionBlockIds]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!descriptor || !session || event.button !== 0) return
      const canvas = canvasRef.current
      if (!canvas) return

      const { x, y } = canvasPointFromEvent(canvas, event)
      const hit = hitTestFrameDescriptor(descriptor, x, y)
      const additive = event.shiftKey || event.metaKey || event.ctrlKey

      if (!hit?.elementId) {
        dragRef.current = {
          mode: 'box',
          pointerId: event.pointerId,
          startX: x,
          startY: y,
          active: false,
          additive,
        }
        return
      }

      event.preventDefault()
      canvas.setPointerCapture(event.pointerId)

      const parsed = parseTextElementId(hit.elementId)

      if (parsed.textKind === 'template' && parsed.blockId) {
        const blockIds = resolveCaptionDragTargets(parsed.blockId)
        const startOffsets = new Map<string, { xPct: number; yPct: number }>()
        for (const blockId of blockIds) {
          const offset = readCaptionOffset(blockId)
          if (offset) startOffsets.set(blockId, offset)
        }
        if (startOffsets.size === 0) return

        if (!selectedCaptionBlockIds.includes(parsed.blockId)) {
          onSelectCaption?.(parsed.blockId, { additive })
        }

        dragRef.current = {
          mode: 'caption',
          pointerId: event.pointerId,
          startX: x,
          startY: y,
          dragging: false,
          blockIds,
          startOffsets,
        }
        return
      }

      const overlayIds = resolveOverlayDragTargets(hit.elementId)
      const startPositions = new Map<string, { positionX: number; positionY: number }>()
      for (const id of overlayIds) {
        const position = readOverlayPosition(id)
        if (position) startPositions.set(id, position)
      }
      if (startPositions.size === 0) return

      if (!selectedOverlayIds.includes(hit.elementId)) {
        onSelectOverlay?.(hit.elementId, {
          additive,
          seekPlayhead: false,
        })
      }

      dragRef.current = {
        mode: 'overlay',
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
      onSelectCaption,
      onSelectOverlay,
      readCaptionOffset,
      readOverlayPosition,
      resolveCaptionDragTargets,
      resolveOverlayDragTargets,
      selectedCaptionBlockIds,
      selectedOverlayIds,
      session,
    ]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId || !descriptor) return

      const canvas = canvasRef.current
      if (!canvas) return
      const { x, y } = canvasPointFromEvent(canvas, event)
      const dx = x - drag.startX
      const dy = y - drag.startY

      if (drag.mode === 'box') {
        if (!drag.active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
          drag.active = true
          canvas.setPointerCapture(event.pointerId)
        }

        const box = normalizeSelectionRect(
          { x: drag.startX, y: drag.startY },
          { x, y }
        )
        setSelectionBoxStyle(canvasRectToOverlayStyle(canvas, box))
        setBoxSelection?.(resolveBoxSelectionItems(descriptor, box), {
          additive: drag.additive,
        })
        return
      }

      if (!drag.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        drag.dragging = true
        beginOverlayDragHistory()
      }

      if (drag.mode === 'overlay') {
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
        return
      }

      const updates = drag.blockIds.flatMap((blockId) => {
        const start = drag.startOffsets.get(blockId)
        if (!start) return []
        return [
          {
            blockId,
            position_offset_x_pct: start.xPct + (dx / descriptor.width) * 100,
            position_offset_y_pct: start.yPct - (dy / descriptor.height) * 100,
          },
        ]
      })
      moveCaptionOffsets(updates, { recordHistory: false })
    },
    [
      beginOverlayDragHistory,
      canvasRef,
      descriptor,
      moveCaptionOffsets,
      moveOverlayPositions,
      setBoxSelection,
    ]
  )

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      const canvas = canvasRef.current
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }

      const additive = event.shiftKey || event.metaKey || event.ctrlKey

      if (drag.mode === 'box') {
        if (!drag.active) {
          clearEditorSelection?.()
        }
        setSelectionBoxStyle(null)
        dragRef.current = null
        return
      }

      if (!drag.dragging) {
        if (drag.mode === 'caption') {
          onSelectCaption?.(drag.blockIds[0] ?? null, { additive })
        } else {
          onSelectOverlay?.(drag.overlayIds[0] ?? null, {
            additive,
            seekPlayhead: false,
          })
        }
      }

      dragRef.current = null
    },
    [canvasRef, clearEditorSelection, onSelectCaption, onSelectOverlay]
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      finishDrag(event)
    },
    [finishDrag]
  )

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      setSelectionBoxStyle(null)
      finishDrag(event)
    },
    [finishDrag]
  )

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    selectionBoxStyle,
  }
}
