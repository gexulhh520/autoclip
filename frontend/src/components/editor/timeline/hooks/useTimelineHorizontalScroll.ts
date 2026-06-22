import { useCallback, useEffect, useState, type RefObject } from 'react'

export function useTimelineHorizontalScroll(
  tracksScrollRef: RefObject<HTMLDivElement | null>,
  contentWidth: number,
  viewportWidth: number
) {
  const maxScrollLeft = Math.max(0, Math.round(contentWidth - viewportWidth))
  const [scrollLeft, setScrollLeftState] = useState(0)

  useEffect(() => {
    const el = tracksScrollRef.current
    if (!el) return
    const sync = () => setScrollLeftState(el.scrollLeft)
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    return () => el.removeEventListener('scroll', sync)
  }, [tracksScrollRef, contentWidth, viewportWidth])

  const setScrollLeft = useCallback(
    (left: number) => {
      const el = tracksScrollRef.current
      if (!el) return
      const clamped = Math.max(0, Math.min(maxScrollLeft, left))
      el.scrollLeft = clamped
      setScrollLeftState(clamped)
    },
    [tracksScrollRef, maxScrollLeft]
  )

  return { scrollLeft, maxScrollLeft, setScrollLeft, canScrollHorizontally: maxScrollLeft > 0 }
}

export function setTracksScrollLeft(
  tracksScrollRef: RefObject<HTMLDivElement | null>,
  scrollLeft: number
): void {
  const el = tracksScrollRef.current
  if (!el) return
  const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
  el.scrollLeft = Math.max(0, Math.min(maxScrollLeft, scrollLeft))
}
