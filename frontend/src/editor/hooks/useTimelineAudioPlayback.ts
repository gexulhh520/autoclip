import { useCallback, useEffect, useMemo, useRef } from 'react'
import editApi from '../../services/editApi'
import { findAudioAsset, getAudioClipTrackId } from '../audioTracks'
import type { AudioClipElement } from '../../types/editSession'
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

type ClipRuntimeMode = 'idle' | 'playing'

/** 时间线多音频轨预览：播放中不 seek、不改 playbackRate，仅在片段边界起停 */
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

  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying

  const resolvePlayheadSec = useCallback(() => {
    if (isPlayingRef.current && resolveLivePlayheadSec) {
      return resolveLivePlayheadSec()
    }
    return playheadRef.current
  }, [resolveLivePlayheadSec])

  const clipModeRef = useRef<Map<string, ClipRuntimeMode>>(new Map())

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
  const elementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  const sourceTimeForClip = (clip: AudioClipElement, compositionSec: number) =>
    compositionSec - clip.start_sec + (clip.trim_start_sec ?? 0)

  const ensureContainer = () => {
    if (!containerRef.current) {
      containerRef.current = document.createElement('div')
      containerRef.current.setAttribute('aria-hidden', 'true')
      containerRef.current.style.display = 'none'
      document.body.appendChild(containerRef.current)
    }
    return containerRef.current
  }

  const syncAudioElements = () => {
    const container = ensureContainer()
    const elements = elementsRef.current

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
        clipModeRef.current.delete(item.clip.id)
      }
      elements.set(item.clip.id, audio)
    }

    for (const [clipId, audio] of [...elements.entries()]) {
      if (!clips.some((item) => item.clip.id === clipId)) {
        audio.pause()
        clipModeRef.current.delete(clipId)
        audio.remove()
        elements.delete(clipId)
      }
    }
  }

  const stopClip = (audio: HTMLAudioElement, clipId: string) => {
    audio.pause()
    audio.playbackRate = 1
    clipModeRef.current.set(clipId, 'idle')
  }

  const startClip = (
    audio: HTMLAudioElement,
    clip: AudioClipElement,
    compositionSec: number,
    clipId: string
  ) => {
    const sourceTime = Math.max(0, sourceTimeForClip(clip, compositionSec))
    audio.playbackRate = 1
    audio.currentTime = sourceTime
    clipModeRef.current.set(clipId, 'playing')
    void audio.play().catch(() => {
      clipModeRef.current.set(clipId, 'idle')
    })
  }

  const syncPausedAtPlayhead = () => {
    const playhead = playheadRef.current
    for (const item of clips) {
      const audio = elementsRef.current.get(item.clip.id)
      if (!audio) continue
      const { clip } = item
      const clipEnd = clip.start_sec + clip.duration_sec
      const inRange = playhead >= clip.start_sec && playhead < clipEnd
      audio.volume = item.muted ? 0 : item.volume
      stopClip(audio, clip.id)
      if (inRange) {
        const sourceTime = sourceTimeForClip(clip, playhead)
        if (Math.abs(audio.currentTime - sourceTime) > PAUSED_SEEK_THRESHOLD_SEC) {
          audio.currentTime = Math.max(0, sourceTime)
        }
      }
    }
  }

  const syncPlayingTransport = () => {
    const playhead = resolvePlayheadSec()
    for (const item of clips) {
      const audio = elementsRef.current.get(item.clip.id)
      if (!audio) continue
      const { clip } = item
      const clipEnd = clip.start_sec + clip.duration_sec
      const inRange = playhead >= clip.start_sec && playhead < clipEnd
      const mode = clipModeRef.current.get(clip.id) ?? 'idle'

      audio.volume = item.muted ? 0 : item.volume

      if (!inRange || item.muted) {
        if (mode === 'playing') {
          stopClip(audio, clip.id)
        }
        continue
      }

      if (mode === 'idle') {
        startClip(audio, clip, playhead, clip.id)
      }
    }
  }

  useEffect(() => {
    syncAudioElements()
  }, [clips])

  useEffect(() => {
    if (isPlaying) {
      clipModeRef.current.clear()
      syncPlayingTransport()
      return
    }
    syncPausedAtPlayhead()
    clipModeRef.current.clear()
  }, [isPlaying, clips])

  useEffect(() => {
    if (isPlaying) return
    syncPausedAtPlayhead()
  }, [playheadSec, clips, isPlaying])

  useEffect(() => {
    if (!isPlaying) return undefined
    let raf = 0
    const tick = () => {
      if (!isPlayingRef.current) return
      syncPlayingTransport()
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [isPlaying, clips, resolvePlayheadSec])

  useEffect(() => {
    return () => {
      for (const audio of elementsRef.current.values()) {
        audio.pause()
      }
      elementsRef.current.clear()
      clipModeRef.current.clear()
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
