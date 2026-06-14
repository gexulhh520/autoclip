import React, { useRef } from 'react'
import QuoteOverlayPreview, {
  type OverlayPreviewConfig,
  type OverlayPreviewLayer,
} from '../QuoteOverlayPreview'
import type { EditBlock } from '../../types/editSession'

interface TemplateCaptionLayerProps {
  blockId: string
  block?: EditBlock
  opacity: number
  layout: 'cinema' | 'highlight' | 'none'
  layers: OverlayPreviewLayer[]
  config?: OverlayPreviewConfig
  selected: boolean
  selectedBlockIds?: string[]
  onSelect: (blockId: string, options?: { additive?: boolean }) => void
  onPositionChange: (
    blockId: string,
    patch: { position_offset_x_pct: number; position_offset_y_pct: number },
    options?: { recordHistory?: boolean }
  ) => void
  onGroupPositionChange?: (
    blockIds: string[],
    delta: { position_offset_x_pct: number; position_offset_y_pct: number },
    options?: { recordHistory?: boolean }
  ) => void
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
  onSelect,
  onPositionChange,
  onGroupPositionChange,
  getCaptionOffset,
  onLayerRef,
}) => {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
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

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    onSelect(blockId, { additive })
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

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: block?.overlay.position_offset_x_pct ?? 0,
      originY: block?.overlay.position_offset_y_pct ?? 0,
      frameW: frame.clientWidth,
      frameH: frame.clientHeight,
      groupIds,
      origins,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const applyDragDelta = (
    drag: NonNullable<typeof dragRef.current>,
    clientX: number,
    clientY: number,
    options?: { recordHistory?: boolean }
  ) => {
    const deltaXPct = ((clientX - drag.startX) / drag.frameW) * 100
    const deltaYPct = -((clientY - drag.startY) / drag.frameH) * 100

    if (drag.groupIds.length > 1 && onGroupPositionChange) {
      onGroupPositionChange(
        drag.groupIds,
        { position_offset_x_pct: deltaXPct, position_offset_y_pct: deltaYPct },
        options
      )
      return
    }

    if (drag.groupIds.length > 1) {
      for (const id of drag.groupIds) {
        const origin = drag.origins.get(id)
        if (!origin) continue
        onPositionChange(
          id,
          {
            position_offset_x_pct: origin.x + deltaXPct,
            position_offset_y_pct: origin.y + deltaYPct,
          },
          options
        )
      }
      return
    }

    onPositionChange(
      blockId,
      {
        position_offset_x_pct: drag.originX + deltaXPct,
        position_offset_y_pct: drag.originY + deltaYPct,
      },
      options
    )
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyDragDelta(drag, event.clientX, event.clientY, { recordHistory: false })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyDragDelta(drag, event.clientX, event.clientY, { recordHistory: true })
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={onLayerRef}
      className="editor-preview-caption-layer"
      style={{ opacity }}
      data-preview-caption-id={blockId}
    >
      <QuoteOverlayPreview
        layout={layout}
        layers={layers}
        config={mergedConfig}
        interactive
        selected={selected}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}

export default TemplateCaptionLayer
