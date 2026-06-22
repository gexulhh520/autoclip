import { useEffect, useRef } from 'react'

/** 主轨道视口与底部横向滚动条双向同步 scrollLeft */
export function useHorizontalScrollSync(
  tracksScrollRef: React.RefObject<HTMLDivElement | null>,
  horizontalScrollRef: React.RefObject<HTMLDivElement | null>
) {
  const isUpdatingRef = useRef(false)

  useEffect(() => {
    const tracksViewport = tracksScrollRef.current
    const horizontalBar = horizontalScrollRef.current
    if (!tracksViewport || !horizontalBar) return

    const syncFromTracks = () => {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true
      horizontalBar.scrollLeft = tracksViewport.scrollLeft
      isUpdatingRef.current = false
    }

    const syncFromHorizontalBar = () => {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true
      tracksViewport.scrollLeft = horizontalBar.scrollLeft
      isUpdatingRef.current = false
    }

    horizontalBar.scrollLeft = tracksViewport.scrollLeft
    tracksViewport.addEventListener('scroll', syncFromTracks)
    horizontalBar.addEventListener('scroll', syncFromHorizontalBar)
    return () => {
      tracksViewport.removeEventListener('scroll', syncFromTracks)
      horizontalBar.removeEventListener('scroll', syncFromHorizontalBar)
    }
  }, [tracksScrollRef, horizontalScrollRef])
}

export function setSyncedTimelineScrollLeft(
  tracksScrollRef: React.RefObject<HTMLDivElement | null>,
  horizontalScrollRef: React.RefObject<HTMLDivElement | null>,
  scrollLeft: number
): void {
  const tracksViewport = tracksScrollRef.current
  const horizontalBar = horizontalScrollRef.current
  if (tracksViewport) tracksViewport.scrollLeft = scrollLeft
  if (horizontalBar) horizontalBar.scrollLeft = scrollLeft
}
