import type { CompositionTimelineSegment } from '../scene/timelineLayout'
import type { TransitionOutKind } from '../../types/transitions'
import { isCrossTransition } from '../../types/transitions'
import {
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'

export interface VideoTimelineDisplayClip {
  blockId: string
  visualStartSec: number
  visualEndSec: number
  displayStartSec: number
  displayDurationSec: number
}

export interface VideoTimelineTransitionMarker {
  id: string
  startSec: number
  durationSec: number
  kind: TransitionOutKind
  fromBlockId: string
  toBlockId: string
}

export interface VideoTimelineDisplayLayout {
  clips: VideoTimelineDisplayClip[]
  transitions: VideoTimelineTransitionMarker[]
}

const MIN_DISPLAY_SEC = 0.05

/**
 * 主轨 UI：视频块按可视起止非重叠排列，转场叠化区单独用标记表示。
 * 播放/裁切仍使用 visualStart/visualEnd（composition 时间）。
 */
export function buildVideoTimelineDisplayLayout(
  segments: CompositionTimelineSegment[]
): VideoTimelineDisplayLayout {
  const clips: VideoTimelineDisplayClip[] = []
  const transitions: VideoTimelineTransitionMarker[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const block = segment.block
    const visualStartSec = blockTimelineVisualStartSec(segment.startSec, block)
    const visualEndSec = blockTimelineVisualEndSec(segment.startSec, block)

    let displayStartSec = visualStartSec
    let displayEndSec = visualEndSec

    if (index > 0) {
      const prev = segments[index - 1]!
      if (
        prev.dissolveOutSec > 0 &&
        isCrossTransition(prev.block.transition_out)
      ) {
        displayStartSec = visualStartSec + prev.dissolveOutSec
      }
    }

    if (
      segment.dissolveOutSec > 0 &&
      isCrossTransition(block.transition_out) &&
      index + 1 < segments.length
    ) {
      const next = segments[index + 1]!
      displayEndSec = visualEndSec - segment.dissolveOutSec
      transitions.push({
        id: `transition-${block.id}-${next.block.id}`,
        startSec: visualEndSec - segment.dissolveOutSec,
        durationSec: segment.dissolveOutSec,
        kind: block.transition_out,
        fromBlockId: block.id,
        toBlockId: next.block.id,
      })
    }

    clips.push({
      blockId: block.id,
      visualStartSec,
      visualEndSec,
      displayStartSec,
      displayDurationSec: Math.max(MIN_DISPLAY_SEC, displayEndSec - displayStartSec),
    })
  }

  return { clips, transitions }
}
