import type { AudioClipElement, EditBlock } from '../types/editSession'
import { blockSourceTrimDuration } from '../utils/editTimeline'

export const MIN_PLAYBACK_RATE = 0.25
export const MAX_PLAYBACK_RATE = 4
export const MIN_TIMELINE_DURATION_SEC = 0.05

export const PLAYBACK_RATE_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export type SpeedControlMode = 'rate' | 'duration'

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate))
}

export function resolveBlockSourceDurationSec(block: EditBlock): number {
  return Math.max(MIN_TIMELINE_DURATION_SEC, blockSourceTrimDuration(block))
}

export function resolveBlockTimelineDurationSec(block: EditBlock): number {
  const rate = clampPlaybackRate(block.playback_rate ?? 1)
  return resolveBlockSourceDurationSec(block) / rate
}

export function resolveAudioClipSourceDurationSec(clip: AudioClipElement): number {
  const trimStart = clip.trim_start_sec ?? 0
  const rate = clampPlaybackRate(clip.playback_rate ?? 1)
  if (clip.trim_end_sec != null && clip.trim_end_sec > trimStart) {
    return Math.max(MIN_TIMELINE_DURATION_SEC, clip.trim_end_sec - trimStart)
  }
  return Math.max(MIN_TIMELINE_DURATION_SEC, clip.duration_sec * rate)
}

export function resolveAudioClipTimelineDurationSec(clip: AudioClipElement): number {
  return Math.max(MIN_TIMELINE_DURATION_SEC, clip.duration_sec)
}

export function playbackRateFromTimelineDuration(
  sourceDurationSec: number,
  timelineDurationSec: number
): number {
  const safeTimeline = Math.max(MIN_TIMELINE_DURATION_SEC, timelineDurationSec)
  return clampPlaybackRate(sourceDurationSec / safeTimeline)
}

export function timelineDurationFromPlaybackRate(
  sourceDurationSec: number,
  playbackRate: number
): number {
  const rate = clampPlaybackRate(playbackRate)
  return Math.max(MIN_TIMELINE_DURATION_SEC, sourceDurationSec / rate)
}

export function buildBlockSpeedPatch(
  block: EditBlock,
  input: { playbackRate?: number; timelineDurationSec?: number }
): { playback_rate: number } | null {
  const sourceDurationSec = resolveBlockSourceDurationSec(block)
  if (input.playbackRate != null) {
    return { playback_rate: clampPlaybackRate(input.playbackRate) }
  }
  if (input.timelineDurationSec != null) {
    return {
      playback_rate: playbackRateFromTimelineDuration(
        sourceDurationSec,
        input.timelineDurationSec
      ),
    }
  }
  return null
}

export function buildAudioClipSpeedPatch(
  clip: AudioClipElement,
  input: { playbackRate?: number; timelineDurationSec?: number }
): Partial<AudioClipElement> | null {
  const trimStart = clip.trim_start_sec ?? 0
  const sourceDurationSec = resolveAudioClipSourceDurationSec(clip)
  const trimEnd = trimStart + sourceDurationSec

  let rate = clampPlaybackRate(clip.playback_rate ?? 1)
  if (input.playbackRate != null) {
    rate = clampPlaybackRate(input.playbackRate)
  } else if (input.timelineDurationSec != null) {
    rate = playbackRateFromTimelineDuration(sourceDurationSec, input.timelineDurationSec)
  } else {
    return null
  }

  return {
    playback_rate: rate,
    duration_sec: timelineDurationFromPlaybackRate(sourceDurationSec, rate),
    trim_start_sec: trimStart,
    trim_end_sec: trimEnd,
  }
}
