import type { EditBlock } from '../../types/editSession'
import { blockDuration, blockPlaybackRate, blockSourceTrimDuration } from '../../utils/editTimeline'
import { computeDissolveDuration } from '../../utils/editDissolvePreview'
import type { CompositionSegment, CompositionTimeline } from './types'

export type { CompositionSegment, CompositionTimeline }

/** 与 TimelineSegment 兼容的合成时间轴片段（供时间线 UI / 播放头） */
export interface CompositionTimelineSegment {
  block: EditBlock
  startSec: number
  endSec: number
  duration: number
  left: number
  width: number
  dissolveOutSec: number
}

export function buildCompositionTimeline(
  blocks: EditBlock[],
  transitionDurationSec: number
): CompositionTimeline {
  if (blocks.length === 0) {
    return { segments: [], totalDurationSec: 0, transitionDurationSec }
  }

  const segments: CompositionSegment[] = []
  let compositionCursor = 0

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const sourceDurationSec = blockDuration(block)
    const hasNext = index < blocks.length - 1
    const dissolveOutSec =
      hasNext && block.transition_out === 'dissolve'
        ? computeDissolveDuration(sourceDurationSec, transitionDurationSec)
        : 0

    segments.push({
      block,
      index,
      compositionStartSec: compositionCursor,
      sourceDurationSec,
      transitionOut: block.transition_out,
      dissolveOutSec,
    })

    compositionCursor += sourceDurationSec - dissolveOutSec
  }

  const last = segments[segments.length - 1]
  const totalDurationSec = last.compositionStartSec + last.sourceDurationSec

  return {
    segments,
    totalDurationSec: Math.max(0, totalDurationSec),
    transitionDurationSec,
  }
}

export function findDissolveAtTime(
  timeline: CompositionTimeline,
  timeSec: number
): {
  outgoing: CompositionSegment
  incoming: CompositionSegment
  progress: number
} | null {
  const { segments } = timeline
  if (segments.length < 2) return null

  for (let index = 0; index < segments.length - 1; index += 1) {
    const outgoing = segments[index]
    const incoming = segments[index + 1]
    if (outgoing.dissolveOutSec <= 0) continue

    const dissolveStart =
      outgoing.compositionStartSec + outgoing.sourceDurationSec - outgoing.dissolveOutSec
    const dissolveEnd = outgoing.compositionStartSec + outgoing.sourceDurationSec

    if (timeSec < dissolveStart - 0.001 || timeSec > dissolveEnd + 0.001) {
      continue
    }

    const progress = Math.min(
      1,
      Math.max(0, (timeSec - dissolveStart) / outgoing.dissolveOutSec)
    )
    return { outgoing, incoming, progress }
  }

  return null
}

/** 合成时间轴 t → 某 segment 内的源相对时间 */
export function mapCompositionTimeToRelativeSource(
  segment: CompositionSegment,
  timeSec: number
): number {
  const relTimeline = timeSec - segment.compositionStartSec
  const rate = blockPlaybackRate(segment.block)
  const sourceTrim = blockSourceTrimDuration(segment.block)
  return Math.max(0, Math.min(sourceTrim, relTimeline * rate))
}

const TRACK_OFFSET_PX = 4

/** 合成时间轴上的片段布局（叠化区视觉重叠） */
export function buildCompositionTimelineSegments(
  blocks: EditBlock[],
  pxPerSec: number,
  transitionDurationSec: number
): CompositionTimelineSegment[] {
  const timeline = buildCompositionTimeline(blocks, transitionDurationSec)
  return timeline.segments.map((segment) => {
    const duration = segment.sourceDurationSec
    const width = duration * pxPerSec
    return {
      block: segment.block,
      startSec: segment.compositionStartSec,
      endSec: segment.compositionStartSec + duration,
      duration,
      left: TRACK_OFFSET_PX + segment.compositionStartSec * pxPerSec,
      width,
      dissolveOutSec: segment.dissolveOutSec,
    }
  })
}

export function getCompositionTotalDuration(
  blocks: EditBlock[],
  transitionDurationSec: number
): number {
  return buildCompositionTimeline(blocks, transitionDurationSec).totalDurationSec
}

export function resolveCompositionPlayhead(
  sequencePlayheadSec: number,
  segments: CompositionTimelineSegment[]
): { segment: CompositionTimelineSegment; relativeSec: number } | null {
  if (segments.length === 0) return null
  const clamped = Math.max(0, sequencePlayheadSec)
  for (const segment of segments) {
    if (clamped < segment.endSec || segment === segments[segments.length - 1]) {
      const relativeSec = Math.min(
        Math.max(0, clamped - segment.startSec),
        segment.duration
      )
      return { segment, relativeSec }
    }
  }
  const last = segments[segments.length - 1]
  return { segment: last, relativeSec: last.duration }
}
