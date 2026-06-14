import React, { useCallback, useEffect, useRef } from 'react'
import type { OpenCutTextOverlay } from '../../editor/opencut-text/params'
import { renderTextOverlayToContext } from '../../editor/opencut-text/render'
import {
  buildTransformFromParams,
  normalizedToPosition,
  positionToNormalized,
} from '../../editor/opencut-text/transform'
import { measureTextOverlay } from '../../editor/opencut-text/measure'

interface OpenCutTextCanvasProps {
  elements: Array<{ element: OpenCutTextOverlay; opacity: number }>
  canvasWidth: number
  canvasHeight: number
  selectedId?: string | null
  interactive?: boolean
  onSelect?: (id: string) => void
  onParamsChange?: (
    id: string,
    patch: Record<string, string | number | boolean>,
    options?: { recordHistory?: boolean }
  ) => void
}

const OpenCutTextCanvas: React.FC<OpenCutTextCanvasProps> = ({
  elements,
  canvasWidth,
  canvasHeight,
  selectedId,
  interactive = false,
  onSelect,
  onParamsChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    id: string
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    frameW: number
    frameH: number
  } | null>(null)

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const displayW = container.clientWidth
    const displayH = container.clientHeight
    if (displayW <= 0 || displayH <= 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(displayW * dpr))
    canvas.height = Math.max(1, Math.round(displayH * dpr))
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scale = (displayW / canvasWidth) * dpr
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)

    for (const { element, opacity } of elements) {
      if (element.hidden) continue
      renderTextOverlayToContext({
        element,
        ctx,
        canvasWidth,
        canvasHeight,
        layerOpacity: opacity,
      })

      if (selectedId === element.id) {
        const measured = measureTextOverlay({ element, canvasHeight, ctx })
        const transform = buildTransformFromParams(element.params)
        const cx = transform.position.x + canvasWidth / 2
        const cy = transform.position.y + canvasHeight / 2
        const rect = measured.visualRect
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(transform.scaleX, transform.scaleY)
        if (transform.rotate) ctx.rotate((transform.rotate * Math.PI) / 180)
        ctx.strokeStyle = 'rgba(45, 107, 255, 0.95)'
        ctx.lineWidth = 2 / scale
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height)
        ctx.restore()
      }
    }
  }, [canvasWidth, canvasHeight, elements, selectedId])

  useEffect(() => {
    paint()
    const frame = window.requestAnimationFrame(() => paint())
    return () => window.cancelAnimationFrame(frame)
  }, [paint])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => paint())
    observer.observe(container)
    return () => observer.disconnect()
  }, [paint])

  const hitTest = useCallback(
    (clientX: number, clientY: number): OpenCutTextOverlay | null => {
      const container = containerRef.current
      if (!container) return null
      const rect = container.getBoundingClientRect()
      const nx = (clientX - rect.left) / rect.width
      const ny = (clientY - rect.top) / rect.height
      const canvasX = nx * canvasWidth
      const canvasY = ny * canvasHeight

      for (let i = elements.length - 1; i >= 0; i--) {
        const { element } = elements[i]
        const transform = buildTransformFromParams(element.params)
        const cx = transform.position.x + canvasWidth / 2
        const cy = transform.position.y + canvasHeight / 2
        const ctx = canvasRef.current?.getContext('2d')
        if (!ctx) continue
        const measured = measureTextOverlay({ element, canvasHeight, ctx })
        const r = measured.visualRect
        const dx = canvasX - cx
        const dy = canvasY - cy
        const rad = (-transform.rotate * Math.PI) / 180
        const localX = (dx * Math.cos(rad) - dy * Math.sin(rad)) / transform.scaleX
        const localY = (dx * Math.sin(rad) + dy * Math.cos(rad)) / transform.scaleY
        if (
          localX >= r.left &&
          localX <= r.left + r.width &&
          localY >= r.top &&
          localY <= r.top + r.height
        ) {
          return element
        }
      }
      return null
    },
    [canvasHeight, canvasWidth, elements]
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    const hit = hitTest(event.clientX, event.clientY)
    if (!hit) return
    event.stopPropagation()
    onSelect?.(hit.id)
    const transform = buildTransformFromParams(hit.params)
    const container = containerRef.current
    if (!container) return
    dragRef.current = {
      id: hit.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.position.x,
      originY: transform.position.y,
      frameW: container.clientWidth,
      frameH: container.clientHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = ((event.clientX - drag.startX) / drag.frameW) * canvasWidth
    const dy = ((event.clientY - drag.startY) / drag.frameH) * canvasHeight
    onParamsChange?.(
      drag.id,
      {
        'transform.positionX': drag.originX + dx,
        'transform.positionY': drag.originY + dy,
      },
      { recordHistory: false }
    )
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onParamsChange?.(drag.id, {}, { recordHistory: true })
  }

  return (
    <div
      ref={containerRef}
      className={`editor-opencut-text-canvas${interactive ? ' is-interactive' : ''}`}
    >
      <canvas
        ref={canvasRef}
        className="editor-opencut-text-canvas__surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}

export default OpenCutTextCanvas
