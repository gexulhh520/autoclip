import React, { useRef } from 'react'
import QuoteOverlayPreview, {
  type OverlayPreviewConfig,
  type OverlayPreviewLayer,
} from '../QuoteOverlayPreview'
import type { EditBlock } from '../../types/editSession'

export interface CaptionDragVisual {
  blockIds: string[]
  deltaXPct: number
  deltaYPct: number
}

interface TemplateCaptionLayerProps {
  blockId: string
  block?: EditBlock
  opacity: number
  layout: 'cinema' | 'highlight' | 'none'
  layers: OverlayPreviewLayer[]
  config?: OverlayPreviewConfig
  selected: boolean
  selectedBlockIds?: string[]
  dragVisual?: CaptionDragVisual | null
  onSelect: (blockId: string, options?: { additive?: boolean }) => void
  onPositionChange: (
    blockId: string,
    patch: { position_offset_x_pct: number; position_offset_y_pct: number },
    options?: { recordHistory?: boolean }
  ) => void
  onDragVisualChange?: (visual: CaptionDragVisual | null) => void
  getCaptionOffset?: (blockId: string) => { x: number; y: number }
  onLayerRef?: (element: HTMLDivElement | null) => void
}

const TemplateCaptionLayer: React.FC<TemplateCaptionLayerProps> = ({
  blockId,
  block,
  opacity,
  layout,
  layers,
  config,
  selected,
  selectedBlockIds = [],
  dragVisual,
  onSelect,
  onPositionChange,
  onDragVisualChange,
  getCaptionOffset,
  onLayerRef,
}) => {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    frameW: number
    frameH: number
    groupIds: string[]
    origins: Map<string, { x: number; y: number }>
  } | null>(null)

  const mergedConfig: OverlayPreviewConfig = {
    ...(config ?? {}),
    position_offset_x_pct: block?.overlay.position_offset_x_pct ?? 0,
    position_offset_y_pct: block?.overlay.position_offset_y_pct ?? 0,
  }

  const isDragVisualActive = dragVisual?.blockIds.includes(blockId) ?? false
  const dragTransform =
    isDragVisualActive && dragVisual
      ? `translate3d(${dragVisual.deltaXPct}%, ${-dragVisual.deltaYPct}%, 0)`
      : undefined

  const commitDrag = (
    drag: NonNullable<typeof dragRef.current>,
    clientX: number,
    clientY: number
  ) => {
    const deltaXPct = ((clientX - drag.startX) / drag.frameW) * 100
    const deltaYPct = -((clientY - drag.startY) / drag.frameH) * 100

    for (const id of drag.groupIds) {
      const origin = drag.origins.get(id)
      if (!origin) continue
      onPositionChange(
        id,
        {
          position_offset_x_pct: origin.x + deltaXPct,
          position_offset_y_pct: origin.y + deltaYPct,
        },
        { recordHistory: true }
      )
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    const alreadySelected = selected || selectedBlockIds.includes(blockId)
    if (additive || !alreadySelected) {
      onSelect(blockId, { additive })
    }
    const frame = event.currentTarget.closest('.editor-preview-frame') as HTMLElement | null
    if (!frame) return

    const groupIds =
      selectedBlockIds.includes(blockId) && selectedBlockIds.length > 1
        ? selectedBlockIds
        : [blockId]

    const origins = new Map<string, { x: number; y: number }>()
    for (const id of groupIds) {
      const offset = getCaptionOffset?.(id) ?? {
        x: id === blockId ? (block?.overlay.position_offset_x_pct ?? 0) : 0,
        y: id === blockId ? (block?.overlay.position_offset_y_pct ?? 0) : 0,
      }
      origins.set(id, offset)
    }

    const startX = event.clientX
    const startY = event.clientY
    const frameW = frame.clientWidth
    const frameH = frame.clientHeight

    dragRef.current = {
      pointerId: event.pointerId,
      startX,
      startY,
      frameW,
      frameH,
      groupIds,
      origins,
    }

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      onDragVisualChange?.({
        blockIds: drag.groupIds,
        deltaXPct: ((moveEvent.clientX - drag.startX) / drag.frameW) * 100,
        deltaYPct: -((moveEvent.clientY - drag.startY) / drag.frameH) * 100,
      })
    }

    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const drag = dragRef.current
      if (drag) {
        commitDrag(drag, upEvent.clientX, upEvent.clientY)
      }
      dragRef.current = null
      onDragVisualChange?.(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={onLayerRef}
      className="editor-preview-caption-layer"
      style={{
        opacity,
        transform: dragTransform,
        willChange: isDragVisualActive ? 'transform' : undefined,
      }}
      data-preview-caption-id={blockId}
    >
      <QuoteOverlayPreview
        layout={layout}
        layers={layers}
        config={mergedConfig}
        interactive
        selected={selected}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}

export default TemplateCaptionLayer
