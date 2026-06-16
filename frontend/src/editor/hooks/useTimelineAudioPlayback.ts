import { useCallback, useEffect, useMemo, useRef } from 'react'
import editApi from '../../services/editApi'
import { findAudioAsset, getAudioClipTrackId } from '../audioTracks'
import type { EditSession } from '../../types/editSession'

interface UseTimelineAudioPlaybackOptions {
  projectId: string
  sessionId: string
  session: EditSession | null
  playheadSec: number
  isPlaying: boolean
  isAssetPreview: boolean
  audioTrackMuted: Record<string, boolean>
}

/** 播放中用墙钟推算平滑 playhead，并用视频 timeupdate 定期重锚，避免 4Hz 阶梯导致音频卡顿 */
function useLivePlayheadClock(playheadSec: number, isPlaying: boolean) {
  const playheadRef = useRef(playheadSec)
  playheadRef.current = playheadSec

  const clockRef = useRef<{ anchorPlayhead: number; anchorWallMs: number } | null>(null)

  useEffect(() => {
    if (isPlaying) {
      clockRef.current = {
        anchorPlayhead: playheadRef.current,
        anchorWallMs: performance.now(),
      }
    } else {
      clockRef.current = null
    }
  }, [isPlaying])

  useEffect(() => {
    if (!isPlaying || !clockRef.current) return
    const estimated =
      clockRef.current.anchorPlayhead +
      (performance.now() - clockRef.current.anchorWallMs) / 1000
    if (Math.abs(playheadSec - estimated) > 0.06) {
      clockRef.current = {
        anchorPlayhead: playheadSec,
        anchorWallMs: performance.now(),
      }
    }
  }, [playheadSec, isPlaying])

  const resolvePlayheadSec = useCallback(() => {
    if (!isPlaying || !clockRef.current) {
      return playheadRef.current
    }
    const { anchorPlayhead, anchorWallMs } = clockRef.current
    return anchorPlayhead + (performance.now() - anchorWallMs) / 1000
  }, [isPlaying])

  return { resolvePlayheadSec, playheadRef }
}

const PLAYING_SEEK_THRESHOLD_SEC = 0.35
const PAUSED_SEEK_THRESHOLD_SEC = 0.05

/** 时间线多音频轨预览：每个 clip 独立 audio 元素，与主时间轴同步 */
export function useTimelineAudioPlayback({
  projectId,
  sessionId,
  session,
  playheadSec,
  isPlaying,
  isAssetPreview,
  audioTrackMuted = {},
}: UseTimelineAudioPlaybackOptions): void {
  const { resolvePlayheadSec } = useLivePlayheadClock(playheadSec, isPlaying)
  const syncedClipIdsRef = useRef<Set<string>>(new Set())

  const clips = useMemo(() => {
    if (!session || isAssetPreview) return []
    return (session.audio_elements ?? [])
      .filter((clip) => !clip.hidden)
      .map((clip) => {
        const asset = findAudioAsset(session, clip.asset_id)
        if (!asset) return null
        const trackId = getAudioClipTrackId(clip)
        return {
          clip,
          asset,
          trackId,
          url: editApi.getAudioAssetUrl(projectId, sessionId, asset.id),
          volume: clip.volume ?? session.audio_settings.bgm_volume ?? 0.28,
          muted: audioTrackMuted[trackId] ?? false,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item != null)
  }, [session, isAssetPreview, projectId, sessionId, audioTrackMuted])

  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isPlaying) {
      syncedClipIdsRef.current.clear()
    }
  }, [isPlaying])

  useEffect(() => {
    if (!containerRef.current) {
      containerRef.current = document.createElement('div')
      containerRef.current.setAttribute('aria-hidden', 'true')
      containerRef.current.style.display = 'none'
      document.body.appendChild(containerRef.current)
    }
    const container = containerRef.current
    const elements = new Map<string, HTMLAudioElement>()

    for (const item of clips) {
      let audio = container.querySelector<HTMLAudioElement>(`[data-clip-id="${item.clip.id}"]`)
      if (!audio) {
        audio = document.createElement('audio')
        audio.dataset.clipId = item.clip.id
        audio.preload = 'auto'
        container.appendChild(audio)
      }
      if (audio.src !== item.url) {
        audio.src = item.url
        syncedClipIdsRef.current.delete(item.clip.id)
      }
      elements.set(item.clip.id, audio)
    }

    container.querySelectorAll('audio').forEach((node) => {
      const id = node.dataset.clipId
      if (id && !elements.has(id)) {
        syncedClipIdsRef.current.delete(id)
        node.remove()
      }
    })

    const syncAll = () => {
      const playhead = resolvePlayheadSec()
      const seekThreshold = isPlaying ? PLAYING_SEEK_THRESHOLD_SEC : PAUSED_SEEK_THRESHOLD_SEC

      for (const item of clips) {
        const audio = elements.get(item.clip.id)
        if (!audio) continue
        const { clip } = item
        const clipEnd = clip.start_sec + clip.duration_sec
        const inRange = playhead >= clip.start_sec && playhead < clipEnd
        audio.volume = item.muted ? 0 : item.volume
        const sourceTime = playhead - clip.start_sec + (clip.trim_start_sec ?? 0)

        if (inRange) {
          const neverSyncedThisPlay = isPlaying && !syncedClipIdsRef.current.has(item.clip.id)
          const drifted = Math.abs(audio.currentTime - sourceTime) > seekThreshold
          if (!isPlaying || neverSyncedThisPlay || drifted) {
            audio.currentTime = Math.max(0, sourceTime)
            if (isPlaying) {
              syncedClipIdsRef.current.add(item.clip.id)
            }
          }
          if (isPlaying && !item.muted) {
            void audio.play().catch(() => undefined)
          } else {
            audio.pause()
          }
        } else {
          syncedClipIdsRef.current.delete(item.clip.id)
          audio.pause()
        }
      }
    }

    syncAll()
    for (const audio of elements.values()) {
      audio.addEventListener('canplay', syncAll)
    }

    let raf = 0
    if (isPlaying) {
      const tick = () => {
        syncAll()
        raf = window.requestAnimationFrame(tick)
      }
      raf = window.requestAnimationFrame(tick)
    }

    return () => {
      window.cancelAnimationFrame(raf)
      for (const audio of elements.values()) {
        audio.removeEventListener('canplay', syncAll)
      }
    }
  }, [clips, isPlaying, playheadSec, resolvePlayheadSec])

  useEffect(() => {
    return () => {
      containerRef.current?.remove()
      containerRef.current = null
    }
  }, [])
}

export function syncTimelineAudioToPlayhead(
  session: EditSession | null,
  playheadSec: number,
  audioTrackMuted: Record<string, boolean>,
  container: HTMLElement | null
): void {
  if (!session || !container) return
  for (const clip of session.audio_elements ?? []) {
    if (clip.hidden) continue
    const trackId = getAudioClipTrackId(clip)
    if (audioTrackMuted[trackId]) continue
    const audio = container.querySelector<HTMLAudioElement>(`[data-clip-id="${clip.id}"]`)
    if (!audio) continue
    const sourceTime = playheadSec - clip.start_sec + (clip.trim_start_sec ?? 0)
    audio.currentTime = Math.max(0, sourceTime)
  }
}
