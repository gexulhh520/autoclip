import { useEffect, useRef } from 'react'

export function useScrollSync(
  tracksScrollRef: React.RefObject<HTMLDivElement | null>,
  trackLabelsScrollRef: React.RefObject<HTMLDivElement | null>
) {
  const isUpdatingRef = useRef(false)

  useEffect(() => {
    const tracksViewport = tracksScrollRef.current
    const trackLabelsViewport = trackLabelsScrollRef.current
    if (!tracksViewport || !trackLabelsViewport) return

    const handleTrackLabelsScroll = () => {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true
      tracksViewport.scrollTop = trackLabelsViewport.scrollTop
      isUpdatingRef.current = false
    }

    const handleTracksVerticalScroll = () => {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true
      trackLabelsViewport.scrollTop = tracksViewport.scrollTop
      isUpdatingRef.current = false
    }

    trackLabelsViewport.addEventListener('scroll', handleTrackLabelsScroll)
    tracksViewport.addEventListener('scroll', handleTracksVerticalScroll)
    return () => {
      trackLabelsViewport.removeEventListener('scroll', handleTrackLabelsScroll)
      tracksViewport.removeEventListener('scroll', handleTracksVerticalScroll)
    }
  }, [tracksScrollRef, trackLabelsScrollRef])
}
