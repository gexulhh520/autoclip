import { useCallback, useEffect, useMemo, useRef } from 'react'
import editApi from '../../services/editApi'
import { playbackRateForDrift } from '../compositor/previewPlayhead'
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
  /** 播放中返回与画面一致的平滑 composition 时间（通常来自 video.currentTime） */
  resolveLivePlayheadSec?: () => number
}

const PAUSED_SEEK_THRESHOLD_SEC = 0.04
const PLAYING_HARD_SEEK_THRESHOLD_SEC = 0.9

/** 时间线多音频轨预览：每个 clip 独立 audio 元素，与主时间轴同步 */
export function useTimelineAudioPlayback({
  projectId,
  sessionId,
  session,
  playheadSec,
  isPlaying,
  isAssetPreview,
  audioTrackMuted = {},
  resolveLivePlayheadSec,
}: UseTimelineAudioPlaybackOptions): void {
  const playheadRef = useRef(playheadSec)
  playheadRef.current = playheadSec

  const resolvePlayheadSec = useCallback(() => {
    if (isPlaying && resolveLivePlayheadSec) {
      return resolveLivePlayheadSec()
    }
    return playheadRef.current
  }, [isPlaying, resolveLivePlayheadSec])

  const syncedClipIdsRef = useRef<Set<string>>(new Set())
  const playingClipIdsRef = useRef<Set<string>>(new Set())

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
      playingClipIdsRef.current.clear()
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
        playingClipIdsRef.current.delete(item.clip.id)
      }
      elements.set(item.clip.id, audio)
    }

    container.querySelectorAll('audio').forEach((node) => {
      const id = node.dataset.clipId
      if (id && !elements.has(id)) {
        syncedClipIdsRef.current.delete(id)
        playingClipIdsRef.current.delete(id)
        node.remove()
      }
    })

    const syncAll = () => {
      const playhead = resolvePlayheadSec()

      for (const item of clips) {
        const audio = elements.get(item.clip.id)
        if (!audio) continue
        const { clip } = item
        const clipEnd = clip.start_sec + clip.duration_sec
        const inRange = playhead >= clip.start_sec && playhead < clipEnd
        audio.volume = item.muted ? 0 : item.volume
        const sourceTime = playhead - clip.start_sec + (clip.trim_start_sec ?? 0)

        if (inRange) {
          const drift = sourceTime - audio.currentTime
          const needsInitialSeek = isPlaying && !syncedClipIdsRef.current.has(item.clip.id)

          if (!isPlaying) {
            audio.playbackRate = 1
            if (Math.abs(drift) > PAUSED_SEEK_THRESHOLD_SEC) {
              audio.currentTime = Math.max(0, sourceTime)
            }
            audio.pause()
            playingClipIdsRef.current.delete(item.clip.id)
          } else if (item.muted) {
            audio.playbackRate = 1
            audio.pause()
            playingClipIdsRef.current.delete(item.clip.id)
          } else if (needsInitialSeek) {
            audio.currentTime = Math.max(0, sourceTime)
            audio.playbackRate = 1
            syncedClipIdsRef.current.add(item.clip.id)
            if (audio.paused) {
              void audio.play().catch(() => undefined)
            }
            playingClipIdsRef.current.add(item.clip.id)
          } else if (Math.abs(drift) > PLAYING_HARD_SEEK_THRESHOLD_SEC) {
            audio.currentTime = Math.max(0, sourceTime)
            audio.playbackRate = 1
            syncedClipIdsRef.current.add(item.clip.id)
            if (audio.paused) {
              void audio.play().catch(() => undefined)
            }
            playingClipIdsRef.current.add(item.clip.id)
          } else {
            audio.playbackRate = playbackRateForDrift(drift)
            if (audio.paused) {
              void audio.play().catch(() => undefined)
            }
            playingClipIdsRef.current.add(item.clip.id)
          }
        } else {
          syncedClipIdsRef.current.delete(item.clip.id)
          audio.playbackRate = 1
          if (!audio.paused) {
            audio.pause()
          }
          playingClipIdsRef.current.delete(item.clip.id)
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
    audio.playbackRate = 1
  }
}
