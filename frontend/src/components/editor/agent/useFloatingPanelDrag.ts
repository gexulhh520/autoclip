import { useCallback, useEffect, useRef, useState } from 'react'

const VIEWPORT_PAD = 12

export interface PanelPosition {
  x: number
  y: number
}

function clampPosition(x: number, y: number, width: number, height: number): PanelPosition {
  const maxX = Math.max(VIEWPORT_PAD, window.innerWidth - width - VIEWPORT_PAD)
  const maxY = Math.max(VIEWPORT_PAD, window.innerHeight - height - VIEWPORT_PAD)
  return {
    x: Math.min(maxX, Math.max(VIEWPORT_PAD, x)),
    y: Math.min(maxY, Math.max(VIEWPORT_PAD, y)),
  }
}

function readStoredPosition(key: string): PanelPosition | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PanelPosition
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return parsed
    }
  } catch {
    // ignore
  }
  return null
}

export function useFloatingPanelDrag(storageKey: string) {
  const panelRef = useRef<HTMLElement>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [position, setPosition] = useState<PanelPosition | null>(() => readStoredPosition(storageKey))
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!position) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(position))
    } catch {
      // ignore
    }
  }, [position, storageKey])

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('button')) return
      const el = panelRef.current
      if (!el) return

      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const origin = position ?? { x: rect.left, y: rect.top }
      if (!position) {
        setPosition(origin)
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: origin.x,
        originY: origin.y,
      }
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [position]
  )

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current
      const el = panelRef.current
      if (!drag || event.pointerId !== drag.pointerId || !el) return

      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      const rect = el.getBoundingClientRect()
      setPosition(clampPosition(drag.originX + dx, drag.originY + dy, rect.width, rect.height))
    }

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      dragStateRef.current = null
      setDragging(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        if (!prev || !panelRef.current) return prev
        const rect = panelRef.current.getBoundingClientRect()
        return clampPosition(prev.x, prev.y, rect.width, rect.height)
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const panelStyle: React.CSSProperties | undefined = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
    : undefined

  return {
    panelRef,
    panelStyle,
    dragging,
    onHeaderPointerDown,
  }
}
