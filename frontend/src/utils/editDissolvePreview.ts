import type { EditBlock } from '../types/editSession'
import type { TimelineSegment } from './editTimeline'
import { blockDuration } from './editTimeline'
import { getCompositionTotalDuration } from '../editor/scene/timelineLayout'

export interface DissolvePreviewState {
  active: boolean
  progress: number
  dissolveSec: number
  outgoing: {
    block: EditBlock
    segment: TimelineSegment
    relativeSec: number
  }
  incoming: {
    block: EditBlock
    segment: TimelineSegment
    relativeSec: number
  }
}

export function computeDissolveDuration(
  blockDurationSec: number,
  transitionDurationSec: number
): number {
  return Math.max(0.1, Math.min(transitionDurationSec, blockDurationSec * 0.45))
}

export function resolveDissolvePreview(
  sequencePlayheadSec: number,
  segments: TimelineSegment[],
  transitionDurationSec: number
): DissolvePreviewState | null {
  if (segments.length < 2) return null

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const next = segments[index + 1]
    if (segment.block.transition_out !== 'dissolve') continue

    const dissolveSec = computeDissolveDuration(segment.duration, transitionDurationSec)
    const dissolveStart = segment.duration - dissolveSec
    const relativeSec = sequencePlayheadSec - segment.startSec

    if (relativeSec < dissolveStart - 0.001 || relativeSec > segment.duration + 0.001) {
      continue
    }

    const progress = Math.min(1, Math.max(0, (relativeSec - dissolveStart) / dissolveSec))
    const incomingRelative = Math.max(0, relativeSec - dissolveStart)

    return {
      active: progress < 1 || relativeSec < segment.duration - 0.001,
      progress,
      dissolveSec,
      outgoing: {
        block: segment.block,
        segment,
        relativeSec: Math.min(relativeSec, segment.duration),
      },
      incoming: {
        block: next.block,
        segment: next,
        relativeSec: incomingRelative,
      },
    }
  }

  return null
}

export function getEffectiveSequenceDuration(
  blocks: EditBlock[],
  transitionDurationSec: number
): number {
  return getCompositionTotalDuration(blocks, transitionDurationSec)
}
