import type { CompositionTimelineSegment } from '../scene/timelineLayout'
import type { TransitionOutKind } from '../../types/transitions'
import { isCrossTransition } from '../../types/transitions'
import {
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'

export interface VideoTimelineTransitionMarker {
  id: string
  startSec: number
  durationSec: number
  kind: TransitionOutKind
  fromBlockId: string
  toBlockId: string
}

/**
 * 主轨转场 UI 标记：以两片段衔接点为中心，各占转场时长的一半。
 * 不修改视频片段的起止与长度。
 */
export function buildVideoTimelineTransitionMarkers(
  segments: CompositionTimelineSegment[]
): VideoTimelineTransitionMarker[] {
  const transitions: VideoTimelineTransitionMarker[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    if (
      segment.dissolveOutSec <= 0 ||
      !isCrossTransition(segment.block.transition_out) ||
      index + 1 >= segments.length
    ) {
      continue
    }

    const next = segments[index + 1]!
    const visualEndSec = blockTimelineVisualEndSec(segment.startSec, segment.block)
    const nextVisualStart = blockTimelineVisualStartSec(next.startSec, next.block)
    if (nextVisualStart - visualEndSec > 0.001) {
      continue
    }

    const junctionSec = (visualEndSec + nextVisualStart) / 2
    const halfDurationSec = segment.dissolveOutSec / 2

    transitions.push({
      id: `transition-${segment.block.id}-${next.block.id}`,
      startSec: junctionSec - halfDurationSec,
      durationSec: segment.dissolveOutSec,
      kind: segment.block.transition_out,
      fromBlockId: segment.block.id,
      toBlockId: next.block.id,
    })
  }

  return transitions
}
