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
  onSelect: (blockId: string) => void
  onPositionChange: (
    blockId: string,
    patch: { position_offset_x_pct: number; position_offset_y_pct: number },
    options?: { recordHistory?: boolean }
  ) => void
}

const TemplateCaptionLayer: React.FC<TemplateCaptionLayerProps> = ({
  blockId,
  block,
  opacity,
  layout,
  layers,
  config,
  selected,
  onSelect,
  onPositionChange,
}) => {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    frameW: number
    frameH: number
  } | null>(null)

  const mergedConfig: OverlayPreviewConfig = {
    ...(config ?? {}),
    position_offset_x_pct: block?.overlay.position_offset_x_pct ?? 0,
    position_offset_y_pct: block?.overlay.position_offset_y_pct ?? 0,
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    onSelect(blockId)
    const frame = event.currentTarget.closest('.editor-preview-frame') as HTMLElement | null
    if (!frame) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: block?.overlay.position_offset_x_pct ?? 0,
      originY: block?.overlay.position_offset_y_pct ?? 0,
      frameW: frame.clientWidth,
      frameH: frame.clientHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaXPct = ((event.clientX - drag.startX) / drag.frameW) * 100
    const deltaYPct = -((event.clientY - drag.startY) / drag.frameH) * 100
    onPositionChange(
      blockId,
      {
        position_offset_x_pct: drag.originX + deltaXPct,
        position_offset_y_pct: drag.originY + deltaYPct,
      },
      { recordHistory: false }
    )
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaXPct = ((event.clientX - drag.startX) / drag.frameW) * 100
    const deltaYPct = -((event.clientY - drag.startY) / drag.frameH) * 100
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onPositionChange(
      blockId,
      {
        position_offset_x_pct: drag.originX + deltaXPct,
        position_offset_y_pct: drag.originY + deltaYPct,
      },
      { recordHistory: true }
    )
  }

  return (
    <div className="editor-preview-caption-layer" style={{ opacity }}>
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
