import type { CompositionTimeline } from './types'
import { isCrossTransition } from '../../types/transitions'
import {
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import { findActiveSegmentAtCompositionTime, findCrossTransitionAtTime, resolveCrossTransitionWindow } from './timelineLayout'

export interface VideoEndedHandoffResult {
  nextPlayheadSec: number
  stopPlayback: boolean
}

/**
 * 主轨 clock 视频 ended 后如何推进播放头。
 * 返回 null 表示忽略（仍在转场区或已完成衔接）。
 */
export function resolveVideoEndedHandoff(
  timeline: CompositionTimeline,
  playheadSec: number,
  endedBlockId: string,
  totalDurationSec: number
): VideoEndedHandoffResult | null {
  if (playheadSec >= totalDurationSec - 0.05) {
    return { nextPlayheadSec: totalDurationSec, stopPlayback: true }
  }

  if (findCrossTransitionAtTime(timeline, playheadSec)) {
    return null
  }

  const endedIndex = timeline.segments.findIndex((item) => item.block.id === endedBlockId)
  if (endedIndex < 0) return null

  const ended = timeline.segments[endedIndex]!
  const active = findActiveSegmentAtCompositionTime(timeline, playheadSec)

  if (
    endedIndex < timeline.segments.length - 1 &&
    ended.dissolveOutSec > 0 &&
    isCrossTransition(ended.transitionOut)
  ) {
    const incoming = timeline.segments[endedIndex + 1]!
    const window = resolveCrossTransitionWindow(ended, incoming)
    if (window && playheadSec < window.endSec - 0.001) {
      return {
        nextPlayheadSec: Math.min(window.endSec + 0.02, totalDurationSec),
        stopPlayback: false,
      }
    }
    if (active && active.index > endedIndex) {
      return null
    }
  }

  if (active && active.block.id !== endedBlockId) {
    return null
  }

  if (endedIndex < timeline.segments.length - 1) {
    const next = timeline.segments[endedIndex + 1]!
    const nextVisualStart = blockTimelineVisualStartSec(
      next.compositionStartSec,
      next.block
    )
    if (playheadSec < nextVisualStart + 0.05) {
      return {
        nextPlayheadSec: Math.min(nextVisualStart + 0.02, totalDurationSec),
        stopPlayback: false,
      }
    }
    return null
  }

  return { nextPlayheadSec: totalDurationSec, stopPlayback: true }
}
