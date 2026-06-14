import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { OpenCutTextOverlay } from '../../editor/opencut-text/params'
import { renderTextOverlayToContext } from '../../editor/opencut-text/render'
import {
  buildTransformFromParams,
} from '../../editor/opencut-text/transform'
import { measureTextOverlay } from '../../editor/opencut-text/measure'
import type { PreviewSelectableTarget } from './hooks/usePreviewBoxSelect'

export interface OpenCutTextCanvasHandle {
  getSelectableTargets: () => PreviewSelectableTarget[]
}

interface OpenCutTextCanvasProps {
  elements: Array<{ element: OpenCutTextOverlay; opacity: number }>
  canvasWidth: number
  canvasHeight: number
  selectedId?: string | null
  selectedIds?: string[]
  interactive?: boolean
  onSelect?: (id: string, options?: { additive?: boolean }) => void
  onParamsChange?: (
    id: string,
    patch: Record<string, string | number | boolean>,
    options?: { recordHistory?: boolean }
  ) => void
}

interface DragVisualState {
  ids: string[]
  dx: number
  dy: number
  origins: Map<string, { x: number; y: number }>
}

const OpenCutTextCanvas = forwardRef<OpenCutTextCanvasHandle, OpenCutTextCanvasProps>(
  (
    {
      elements,
      canvasWidth,
      canvasHeight,
      selectedId,
      selectedIds = [],
      interactive = false,
      onSelect,
      onParamsChange,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const dragVisualRef = useRef<DragVisualState | null>(null)
    const paintRafRef = useRef<number | null>(null)
    const canvasSizeRef = useRef({ width: 0, height: 0 })

    const resolvedSelectedIds =
      selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []

    const getElementScreenBounds = useCallback(
      (element: OpenCutTextOverlay): DOMRect | null => {
        const container = containerRef.current
        const ctx = canvasRef.current?.getContext('2d')
        if (!container || !ctx) return null
        const displayW = container.clientWidth
        const displayH = container.clientHeight
        if (displayW <= 0 || displayH <= 0) return null

        const drag = dragVisualRef.current
        const dragOffset =
          drag?.ids.includes(element.id) ? { x: drag.dx, y: drag.dy } : undefined

        const measured = measureTextOverlay({ element, canvasHeight, ctx })
        const transform = buildTransformFromParams(element.params)
        const cx =
          transform.position.x + (dragOffset?.x ?? 0) + canvasWidth / 2
        const cy =
          transform.position.y + (dragOffset?.y ?? 0) + canvasHeight / 2
        const rect = measured.visualRect
        const scaleX = (displayW / canvasWidth) * transform.scaleX
        const scaleY = (displayH / canvasHeight) * transform.scaleY
        const centerX = (cx / canvasWidth) * displayW
        const centerY = (cy / canvasHeight) * displayH
        const left = container.getBoundingClientRect().left + centerX + rect.left * scaleX
        const top = container.getBoundingClientRect().top + centerY + rect.top * scaleY
        const width = rect.width * scaleX
        const height = rect.height * scaleY
        return new DOMRect(left, top, width, height)
      },
      [canvasHeight, canvasWidth]
    )

    useImperativeHandle(
      ref,
      () => ({
        getSelectableTargets: () =>
          elements
            .filter(({ element }) => !element.hidden)
            .map(({ element }) => ({
              kind: 'overlay' as const,
              id: element.id,
              getBounds: () => getElementScreenBounds(element),
            })),
      }),
      [elements, getElementScreenBounds]
    )

    const paint = useCallback(() => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return

      const displayW = container.clientWidth
      const displayH = container.clientHeight
      if (displayW <= 0 || displayH <= 0) return

      const dpr = window.devicePixelRatio || 1
      const targetW = Math.max(1, Math.round(displayW * dpr))
      const targetH = Math.max(1, Math.round(displayH * dpr))
      if (canvasSizeRef.current.width !== targetW || canvasSizeRef.current.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
        canvas.style.width = `${displayW}px`
        canvas.style.height = `${displayH}px`
        canvasSizeRef.current = { width: targetW, height: targetH }
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const scale = (displayW / canvasWidth) * dpr
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)

      const drag = dragVisualRef.current

      for (const { element, opacity } of elements) {
        if (element.hidden) continue
        const positionOffset =
          drag?.ids.includes(element.id) ? { x: drag.dx, y: drag.dy } : undefined

        renderTextOverlayToContext({
          element,
          ctx,
          canvasWidth,
          canvasHeight,
          layerOpacity: opacity,
          positionOffset,
        })

        if (resolvedSelectedIds.includes(element.id)) {
          const measured = measureTextOverlay({ element, canvasHeight, ctx })
          const transform = buildTransformFromParams(element.params)
          const cx =
            transform.position.x + (positionOffset?.x ?? 0) + canvasWidth / 2
          const cy =
            transform.position.y + (positionOffset?.y ?? 0) + canvasHeight / 2
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
    }, [canvasWidth, canvasHeight, elements, resolvedSelectedIds])

    const schedulePaint = useCallback(() => {
      if (paintRafRef.current != null) return
      paintRafRef.current = window.requestAnimationFrame(() => {
        paintRafRef.current = null
        paint()
      })
    }, [paint])

    useEffect(() => {
      schedulePaint()
    }, [schedulePaint])

    useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const observer = new ResizeObserver(() => schedulePaint())
      observer.observe(container)
      return () => observer.disconnect()
    }, [schedulePaint])

    useEffect(
      () => () => {
        if (paintRafRef.current != null) {
          window.cancelAnimationFrame(paintRafRef.current)
        }
      },
      []
    )

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
          const drag = dragVisualRef.current
          const offsetX = drag?.ids.includes(element.id) ? drag.dx : 0
          const offsetY = drag?.ids.includes(element.id) ? drag.dy : 0
          const cx = transform.position.x + offsetX + canvasWidth / 2
          const cy = transform.position.y + offsetY + canvasHeight / 2
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

    const commitDrag = useCallback(() => {
      const drag = dragVisualRef.current
      if (!drag) return
      for (const id of drag.ids) {
        const origin = drag.origins.get(id)
        if (!origin) continue
        onParamsChange?.(
          id,
          {
            'transform.positionX': origin.x + drag.dx,
            'transform.positionY': origin.y + drag.dy,
          },
          { recordHistory: true }
        )
      }
      dragVisualRef.current = null
      schedulePaint()
    }, [onParamsChange, schedulePaint])

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!interactive) return
      const hit = hitTest(event.clientX, event.clientY)
      if (!hit) return
      event.stopPropagation()
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const alreadySelected = resolvedSelectedIds.includes(hit.id)
      if (additive || !alreadySelected) {
        onSelect?.(hit.id, { additive })
      }

      const dragIds =
        resolvedSelectedIds.includes(hit.id) && resolvedSelectedIds.length > 1
          ? resolvedSelectedIds
          : [hit.id]

      const origins = new Map<string, { x: number; y: number }>()
      for (const id of dragIds) {
        const entry = elements.find((item) => item.element.id === id)
        if (!entry) continue
        const transform = buildTransformFromParams(entry.element.params)
        origins.set(id, { x: transform.position.x, y: transform.position.y })
      }

      const container = containerRef.current
      if (!container) return

      const startX = event.clientX
      const startY = event.clientY
      const frameW = container.clientWidth
      const frameH = container.clientHeight

      dragVisualRef.current = {
        ids: dragIds,
        dx: 0,
        dy: 0,
        origins,
      }

      const onMove = (moveEvent: PointerEvent) => {
        const drag = dragVisualRef.current
        if (!drag) return
        drag.dx = ((moveEvent.clientX - startX) / frameW) * canvasWidth
        drag.dy = ((moveEvent.clientY - startY) / frameH) * canvasHeight
        schedulePaint()
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        commitDrag()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId)
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
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    )
  }
)

OpenCutTextCanvas.displayName = 'OpenCutTextCanvas'

export default OpenCutTextCanvas
