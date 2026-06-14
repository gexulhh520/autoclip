import { useCallback, useEffect, useRef, useState } from 'react'
import {
  normalizeSelectionRect,
  rectsIntersect,
  type BoxSelectableItem,
  type SelectionRect,
} from '../../../editor/selection/boxSelect'

const ACTIVATE_THRESHOLD_PX = 5

interface SelectionBoxState {
  startPos: { x: number; y: number }
  currentPos: { x: number; y: number }
  isActive: boolean
}

export interface PreviewSelectableTarget {
  kind: 'caption' | 'overlay'
  id: string
  getBounds: () => DOMRect | null
}

export function usePreviewBoxSelect(options: {
  frameRef: React.RefObject<HTMLDivElement | null>
  getTargets: () => PreviewSelectableTarget[]
  onSelectionComplete: (items: BoxSelectableItem[], additive: boolean) => void
  enabled?: boolean
}) {
  const { frameRef, getTargets, onSelectionComplete, enabled = true } = options
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null)
  const additiveRef = useRef(false)
  const justFinishedRef = useRef(false)

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return
      const target = event.target as HTMLElement
      if (
        target.closest(
          '.quote-overlay-preview.is-interactive, .editor-opencut-text-canvas__surface, .editor-play-btn, .editor-preview-burn-toggle, .editor-preview-fullscreen-btn, .editor-preview-zoom input'
        )
      ) {
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
      const frame = frameRef.current
      if (!frame) return
      const frameRect = frame.getBoundingClientRect()
      const box: SelectionRect = normalizeSelectionRect(
        {
          x: startPos.x - frameRect.left,
          y: startPos.y - frameRect.top,
        },
        {
          x: endPos.x - frameRect.left,
          y: endPos.y - frameRect.top,
        }
      )

      const items: BoxSelectableItem[] = []
      for (const target of getTargets()) {
        const bounds = target.getBounds()
        if (!bounds) continue
        const targetRect: SelectionRect = {
          left: bounds.left - frameRect.left,
          top: bounds.top - frameRect.top,
          right: bounds.right - frameRect.left,
          bottom: bounds.bottom - frameRect.top,
        }
        if (rectsIntersect(box, targetRect)) {
          items.push({ kind: target.kind, id: target.id })
        }
      }
      onSelectionComplete(items, additiveRef.current)
    },
    [frameRef, getTargets, onSelectionComplete]
  )

  useEffect(() => {
    if (!selectionBox) return

    const onMove = (event: PointerEvent) => {
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

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [selectionBox, selectInBox])

  const selectionBoxStyle =
    selectionBox?.isActive && frameRef.current
      ? (() => {
          const frameRect = frameRef.current!.getBoundingClientRect()
          const box = normalizeSelectionRect(
            {
              x: selectionBox.startPos.x - frameRect.left,
              y: selectionBox.startPos.y - frameRect.top,
            },
            {
              x: selectionBox.currentPos.x - frameRect.left,
              y: selectionBox.currentPos.y - frameRect.top,
            }
          )
          return {
            left: box.left,
            top: box.top,
            width: box.right - box.left,
            height: box.bottom - box.top,
          }
        })()
      : null

  return {
    handlePointerDown,
    selectionBoxStyle,
    isSelecting: selectionBox?.isActive ?? false,
    shouldIgnoreClick: () => justFinishedRef.current,
  }
}
