import React, { useCallback, useRef } from 'react'
import type { EditOverlayElement } from '../../types/editSession'
import { overlayFontFamilyCss } from '../../utils/editOverlayFonts'
import {
  animationClassName,
  buildTextOverlayStyle,
  extractTextStyle,
} from '../../utils/textStyle'

interface EditorTextOverlayLayerProps {
  element: EditOverlayElement
  canvasHeight: number
  layerOpacity?: number
  isSelected?: boolean
  interactive?: boolean
  onSelect?: (id: string) => void
  onTransformChange?: (
    id: string,
    transform: EditOverlayElement['transform'],
    options?: { recordHistory?: boolean }
  ) => void
}

const EditorTextOverlayLayer: React.FC<EditorTextOverlayLayerProps> = ({
  element,
  canvasHeight,
  layerOpacity = 1,
  isSelected = false,
  interactive = false,
  onSelect,
  onTransformChange,
}) => {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    frameRect: DOMRect
  } | null>(null)

  const style = extractTextStyle(element)
  const textStyle = buildTextOverlayStyle({
    fontFamilyCss: overlayFontFamilyCss(element.font_family),
    style,
    canvasHeight,
    transform: element.transform,
    layerOpacity,
  })

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return
      event.stopPropagation()
      onSelect?.(element.id)

      const frame = event.currentTarget.offsetParent as HTMLElement | null
      if (!frame) return

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: element.transform.x,
        originY: element.transform.y,
        frameRect: frame.getBoundingClientRect(),
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [element.id, element.transform.x, element.transform.y, interactive, onSelect]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      const dx = (event.clientX - drag.startX) / drag.frameRect.width
      const dy = (event.clientY - drag.startY) / drag.frameRect.height
      const nextX = Math.max(0.02, Math.min(0.98, drag.originX + dx))
      const nextY = Math.max(0.02, Math.min(0.98, drag.originY + dy))

      onTransformChange?.(
        element.id,
        { ...element.transform, x: nextX, y: nextY },
        { recordHistory: false }
      )
    },
    [element.id, element.transform, onTransformChange]
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      onTransformChange?.(element.id, element.transform, { recordHistory: true })
    },
    [element.id, element.transform, onTransformChange]
  )

  const animClass = animationClassName(style.animation)

  return (
    <div
      className={[
        'editor-free-overlay',
        interactive ? 'is-interactive' : '',
        isSelected ? 'is-selected' : '',
        animClass,
      ]
        .filter(Boolean)
        .join(' ')}
      style={textStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {element.content}
    </div>
  )
}

export default EditorTextOverlayLayer
