import type { BlockTimelineWindow } from './analyzeBlockContentUtils'

/** 片段检索用抽帧上限（低于 analyze_block_content，避免 LLM 轮次过多） */
export const MOMENT_SEARCH_FRAME_LIMITS = {
  MIN: 3,
  MAX: 32,
} as const

export function resolveMomentSearchFrameIntervalSec(durationSec: number): number {
  const duration = Math.max(0.1, durationSec)
  if (duration <= 60) return Math.max(10, duration / 4)
  if (duration <= 300) return 20
  if (duration <= 1800) return 40
  if (duration <= 3600) return 60
  return 90
}

export function resolveMomentSearchFrameSampleCount(
  durationSec: number,
  explicitCount?: number
): number {
  if (
    explicitCount != null &&
    Number.isFinite(explicitCount) &&
    explicitCount > 0
  ) {
    return Math.max(
      MOMENT_SEARCH_FRAME_LIMITS.MIN,
      Math.min(MOMENT_SEARCH_FRAME_LIMITS.MAX, Math.round(explicitCount))
    )
  }
  const interval = resolveMomentSearchFrameIntervalSec(durationSec)
  const estimated = Math.ceil(durationSec / interval)
  return Math.max(
    MOMENT_SEARCH_FRAME_LIMITS.MIN,
    Math.min(MOMENT_SEARCH_FRAME_LIMITS.MAX, estimated)
  )
}

export function resolveMomentSearchSampleTimesSec(
  window: BlockTimelineWindow,
  sampleCount?: number
): number[] {
  const count = resolveMomentSearchFrameSampleCount(window.duration_sec, sampleCount)
  const { start_sec: start, duration_sec: duration } = window
  if (count === 1) return [start + duration * 0.5]
  return Array.from({ length: count }, (_, index) => start + ((index + 0.5) / count) * duration)
}
