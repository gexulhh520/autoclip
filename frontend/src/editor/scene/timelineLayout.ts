import type { EditBlock } from '../../types/editSession'
import type { TransitionOutKind } from '../../types/transitions'
import { isCrossTransition } from '../../types/transitions'
import {
  blockDuration,
  blockPlaybackRate,
  blockSourceTrimDuration,
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import { computeDissolveDuration } from '../../utils/editDissolvePreview'
import type { CompositionSegment, CompositionTimeline } from './types'
import { resolveSequenceBlockGaps } from '../timeline/sequenceBlockGaps'

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
  transitionDurationSec: number,
  blockGaps?: number[]
): CompositionTimeline {
  if (blocks.length === 0) {
    return { segments: [], totalDurationSec: 0, transitionDurationSec }
  }

  const gaps = resolveSequenceBlockGaps(blocks, blockGaps)
  const segments: CompositionSegment[] = []
  let compositionCursor = 0

  for (let index = 0; index < blocks.length; index += 1) {
    if (index > 0) {
      compositionCursor += gaps?.[index - 1] ?? 0
    }

    const block = blocks[index]
    const sourceDurationSec = blockDuration(block)
    const compositionStartSec = compositionCursor
    const hasNext = index < blocks.length - 1
    let dissolveOutSec = 0
    if (hasNext && isCrossTransition(block.transition_out)) {
      const visualEndSec = blockTimelineVisualEndSec(compositionStartSec, block)
      const gapAfter = gaps?.[index] ?? 0
      const nextCompositionStart = visualEndSec + gapAfter
      const nextBlock = blocks[index + 1]!
      const nextVisualStart = blockTimelineVisualStartSec(nextCompositionStart, nextBlock)
      const isAdjacent = nextVisualStart - visualEndSec <= 0.001
      if (isAdjacent) {
        dissolveOutSec = computeDissolveDuration(sourceDurationSec, transitionDurationSec)
      }
    }

    segments.push({
      block,
      index,
      compositionStartSec,
      sourceDurationSec,
      transitionOut: block.transition_out,
      dissolveOutSec,
    })

    const visualEndSec = blockTimelineVisualEndSec(compositionStartSec, block)
    compositionCursor = visualEndSec
  }

  const last = segments[segments.length - 1]
  const totalDurationSec = blockTimelineVisualEndSec(
    last.compositionStartSec,
    last.block
  )

  return {
    segments,
    totalDurationSec: Math.max(0, totalDurationSec),
    transitionDurationSec,
  }
}

export function findCrossTransitionAtTime(
  timeline: CompositionTimeline,
  timeSec: number
): {
  outgoing: CompositionSegment
  incoming: CompositionSegment
  progress: number
  kind: TransitionOutKind
} | null {
  const { segments } = timeline
  if (segments.length < 2) return null

  for (let index = 0; index < segments.length - 1; index += 1) {
    const outgoing = segments[index]
    const incoming = segments[index + 1]
    if (outgoing.dissolveOutSec <= 0) continue

    const dissolveEnd = blockTimelineVisualEndSec(outgoing.compositionStartSec, outgoing.block)
    const dissolveStart = dissolveEnd - outgoing.dissolveOutSec

    if (timeSec < dissolveStart - 0.001 || timeSec > dissolveEnd + 0.001) {
      continue
    }

    const progress = Math.min(
      1,
      Math.max(0, (timeSec - dissolveStart) / outgoing.dissolveOutSec)
    )
    return { outgoing, incoming, progress, kind: outgoing.transitionOut }
  }

  return null
}

/** @deprecated 使用 findCrossTransitionAtTime */
export const findDissolveAtTime = findCrossTransitionAtTime

/** 前一段叠化转场在下一段源素材上的已播放时长（秒） */
export function incomingTransitionSourceLeadInSec(
  segment: CompositionSegment,
  timeline: CompositionTimeline
): number {
  if (segment.index <= 0) return 0
  const prev = timeline.segments[segment.index - 1]
  if (!prev || prev.dissolveOutSec <= 0 || !isCrossTransition(prev.transitionOut)) return 0
  return prev.dissolveOutSec * blockPlaybackRate(segment.block)
}

export function findActiveSegmentAtCompositionTime(
  timeline: CompositionTimeline,
  timeSec: number
): CompositionSegment | null {
  if (timeline.segments.length === 0) return null

  for (let index = timeline.segments.length - 1; index >= 0; index -= 1) {
    const segment = timeline.segments[index]!
    const visualStart = blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
    const visualEnd = blockTimelineVisualEndSec(segment.compositionStartSec, segment.block)
    if (timeSec >= visualStart - 0.001 && timeSec < visualEnd + 0.001) {
      return segment
    }
  }

  return timeline.segments[timeline.segments.length - 1] ?? null
}

/** 转场叠化区内，下一段尚未到可视起点时的源内相对时间 */
export function mapIncomingRelativeDuringCrossTransition(
  outgoing: CompositionSegment,
  incoming: CompositionSegment,
  timeSec: number
): number {
  const dissolveEnd = blockTimelineVisualEndSec(outgoing.compositionStartSec, outgoing.block)
  const dissolveStart = dissolveEnd - outgoing.dissolveOutSec
  const rate = blockPlaybackRate(incoming.block)
  const elapsed = timeSec - dissolveStart
  const sourceTrim = blockSourceTrimDuration(incoming.block)
  return Math.max(0, Math.min(sourceTrim, elapsed * rate))
}

/** 合成时间轴 t → 某 segment 内的源相对时间 */
export function mapCompositionTimeToRelativeSource(
  segment: CompositionSegment,
  timeSec: number,
  timeline?: CompositionTimeline
): number {
  const rate = blockPlaybackRate(segment.block)
  const visualStart = blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
  const elapsed = Math.max(0, timeSec - visualStart)
  const leadIn = timeline ? incomingTransitionSourceLeadInSec(segment, timeline) : 0
  const sourceTrim = blockSourceTrimDuration(segment.block)
  return Math.max(0, Math.min(sourceTrim, leadIn + elapsed * rate))
}

/** 源相对时间 → 合成时间轴 t（与 mapCompositionTimeToRelativeSource 互逆） */
export function mapRelativeSourceToCompositionTime(
  segment: CompositionSegment,
  relativeSourceSec: number,
  timeline?: CompositionTimeline
): number {
  const rate = blockPlaybackRate(segment.block)
  const visualStart = blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
  const leadIn = timeline ? incomingTransitionSourceLeadInSec(segment, timeline) : 0
  const elapsed = Math.max(0, (relativeSourceSec - leadIn) / rate)
  return visualStart + elapsed
}

const TRACK_OFFSET_PX = 4

/** 合成时间轴上的片段布局（转场由独立标记展示，片段不重叠排列） */
export function buildCompositionTimelineSegments(
  blocks: EditBlock[],
  pxPerSec: number,
  transitionDurationSec: number,
  blockGaps?: number[]
): CompositionTimelineSegment[] {
  const timeline = buildCompositionTimeline(blocks, transitionDurationSec, blockGaps)
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
  transitionDurationSec: number,
  blockGaps?: number[]
): number {
  return buildCompositionTimeline(blocks, transitionDurationSec, blockGaps).totalDurationSec
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
