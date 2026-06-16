import { useEffect, useRef } from 'react'

interface UseBgmPreviewPlaybackOptions {
  bgmRef: React.RefObject<HTMLAudioElement | null>
  bgmUrl: string | null
  isPlaying: boolean
  isAssetPreview: boolean
  bgmMuted: boolean
  bgmVolume: number
  playheadSec: number
  bgmStartSec: number
}

/** 预览区 BGM：等待可播后再 play，播放中用 rAF 与主时间轴对齐 */
export function useBgmPreviewPlayback({
  bgmRef,
  bgmUrl,
  isPlaying,
  isAssetPreview,
  bgmMuted,
  bgmVolume,
  playheadSec,
  bgmStartSec,
}: UseBgmPreviewPlaybackOptions): void {
  const playheadRef = useRef(playheadSec)
  playheadRef.current = playheadSec

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || isAssetPreview) return

    const applyVolumeAndPlay = () => {
      bgm.volume = bgmMuted ? 0 : bgmVolume
      if (isPlaying && !bgmMuted) {
        void bgm.play().catch(() => undefined)
      } else {
        bgm.pause()
      }
    }

    applyVolumeAndPlay()
    bgm.addEventListener('canplay', applyVolumeAndPlay)
    return () => bgm.removeEventListener('canplay', applyVolumeAndPlay)
  }, [bgmRef, bgmUrl, isPlaying, bgmVolume, bgmMuted, isAssetPreview])

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || isPlaying || isAssetPreview) return
    const target = Math.max(0, playheadSec + bgmStartSec)
    if (Math.abs(bgm.currentTime - target) > 0.35) {
      bgm.currentTime = target
    }
  }, [bgmRef, playheadSec, bgmUrl, bgmStartSec, isPlaying, isAssetPreview])

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || !isPlaying || isAssetPreview) return

    let raf = 0
    const tick = () => {
      const target = Math.max(0, playheadRef.current + bgmStartSec)
      if (Math.abs(bgm.currentTime - target) > 0.12) {
        bgm.currentTime = target
      }
      raf = window.requestAnimationFrame(tick)
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [bgmRef, bgmUrl, isPlaying, isAssetPreview, bgmStartSec])
}

/** 从视频 timeupdate 同步 BGM 时间（与 rAF 互补，降低漂移） */
export function syncBgmToPlayhead(
  bgm: HTMLAudioElement | null,
  playheadSec: number,
  bgmStartSec: number
): void {
  if (!bgm) return
  bgm.currentTime = Math.max(0, playheadSec + bgmStartSec)
}
