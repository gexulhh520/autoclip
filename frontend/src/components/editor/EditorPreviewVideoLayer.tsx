import React, { useEffect, useRef } from 'react'

interface PreviewVideoLayerProps {
  videoUrl: string
  blurUrl?: string
  showBlurBackground: boolean
  videoFitClass: string
  opacity: number
  volume: number
  playbackRate?: number
  isPlaying: boolean
  targetTimeSec: number
  onMetadata?: (video: HTMLVideoElement) => void
  onTimeUpdate?: (video: HTMLVideoElement) => void
  onEnded?: () => void
}

const PreviewVideoLayer: React.FC<PreviewVideoLayerProps> = ({
  videoUrl,
  showBlurBackground,
  videoFitClass,
  opacity,
  volume,
  playbackRate = 1,
  isPlaying,
  targetTimeSec,
  onMetadata,
  onTimeUpdate,
  onEnded,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const blurRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = Math.min(1, Math.max(0, volume))
  }, [volume, videoUrl])

  useEffect(() => {
    const video = videoRef.current
    const blur = blurRef.current
    if (!video) return
    const rate = Math.max(0.25, Math.min(4, playbackRate))
    video.playbackRate = rate
    if (blur) blur.playbackRate = rate
  }, [playbackRate, videoUrl])

  useEffect(() => {
    const video = videoRef.current
    const blur = blurRef.current
    if (!video) return
    if (isPlaying) {
      if (video.ended) {
        const seekTo = Math.min(
          Math.max(0, targetTimeSec),
          Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : targetTimeSec
        )
        video.currentTime = seekTo
      }
      void video.play().catch(() => undefined)
      if (blur) {
        if (blur.ended) {
          blur.currentTime = Math.min(
            Math.max(0, targetTimeSec),
            Number.isFinite(blur.duration) ? Math.max(0, blur.duration - 0.04) : targetTimeSec
          )
        }
        void blur.play().catch(() => undefined)
      }
    } else {
      video.pause()
      blur?.pause()
    }
  }, [isPlaying, videoUrl, showBlurBackground])

  useEffect(() => {
    const video = videoRef.current
    const blur = blurRef.current
    if (!video || !Number.isFinite(targetTimeSec)) return
    if (Math.abs(video.currentTime - targetTimeSec) > 0.25) {
      video.currentTime = targetTimeSec
    }
    if (blur && Math.abs(blur.currentTime - targetTimeSec) > 0.25) {
      blur.currentTime = targetTimeSec
    }
  }, [targetTimeSec, videoUrl])

  if (!videoUrl) return null

  return (
    <div className="editor-preview-video-layer" style={{ opacity }}>
      {showBlurBackground ? (
        <video
          key={`${videoUrl}-bg`}
          ref={blurRef}
          className="is-cover is-blur-bg"
          src={videoUrl}
          muted
          playsInline
          aria-hidden
        />
      ) : null}
      <video
        ref={videoRef}
        key={videoUrl}
        src={videoUrl}
        className={videoFitClass}
        onLoadedMetadata={(event) => onMetadata?.(event.currentTarget)}
        onTimeUpdate={(event) => onTimeUpdate?.(event.currentTarget)}
        onEnded={onEnded}
      />
    </div>
  )
}

export default PreviewVideoLayer
