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

/** 两相邻主轨片段的衔接点（合成时间轴秒） */
export function mainTrackTransitionJunctionSec(
  outgoing: CompositionSegment,
  incoming: CompositionSegment
): number {
  const outgoingEnd = blockTimelineVisualEndSec(outgoing.compositionStartSec, outgoing.block)
  const incomingStart = blockTimelineVisualStartSec(incoming.compositionStartSec, incoming.block)
  return (outgoingEnd + incomingStart) / 2
}

/** 以衔接点为中心的转场播放窗口：各占时长一半叠在相邻两段上 */
export function resolveCrossTransitionWindow(
  outgoing: CompositionSegment,
  incoming: CompositionSegment
): {
  junctionSec: number
  startSec: number
  endSec: number
  durationSec: number
} | null {
  if (outgoing.dissolveOutSec <= 0) return null
  const junctionSec = mainTrackTransitionJunctionSec(outgoing, incoming)
  const half = outgoing.dissolveOutSec / 2
  return {
    junctionSec,
    startSec: junctionSec - half,
    endSec: junctionSec + half,
    durationSec: outgoing.dissolveOutSec,
  }
}

/** 转场结束后下一段从合成时间轴的何处继续累计源素材时间 */
export function incomingCrossTransitionEndSec(
  segment: CompositionSegment,
  timeline: CompositionTimeline
): number | null {
  if (segment.index <= 0) return null
  const prev = timeline.segments[segment.index - 1]
  if (!prev || prev.dissolveOutSec <= 0 || !isCrossTransition(prev.transitionOut)) return null
  return resolveCrossTransitionWindow(prev, segment)?.endSec ?? null
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

    const window = resolveCrossTransitionWindow(outgoing, incoming)
    if (!window) continue

    if (timeSec < window.startSec - 0.001 || timeSec > window.endSec + 0.001) {
      continue
    }

    const progress = Math.min(
      1,
      Math.max(0, (timeSec - window.startSec) / window.durationSec)
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

  return null
}

/** 转场叠化区内，下一段尚未到可视起点时的源内相对时间 */
export function mapIncomingRelativeDuringCrossTransition(
  outgoing: CompositionSegment,
  incoming: CompositionSegment,
  timeSec: number
): number {
  const window = resolveCrossTransitionWindow(outgoing, incoming)
  if (!window) return 0
  const rate = blockPlaybackRate(incoming.block)
  const elapsed = timeSec - window.startSec
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
  const leadIn = timeline ? incomingTransitionSourceLeadInSec(segment, timeline) : 0
  const crossEnd = timeline ? incomingCrossTransitionEndSec(segment, timeline) : null
  const elapsed =
    crossEnd != null
      ? Math.max(0, timeSec - crossEnd)
      : Math.max(0, timeSec - visualStart)
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
  const crossEnd = timeline ? incomingCrossTransitionEndSec(segment, timeline) : null
  const elapsed = Math.max(0, (relativeSourceSec - leadIn) / rate)
  if (crossEnd != null) {
    return crossEnd + elapsed
  }
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
    const visualStart = blockTimelineVisualStartSec(segment.startSec, segment.block)
    const visualEnd = blockTimelineVisualEndSec(segment.startSec, segment.block)
    if (clamped < visualStart - 0.001 || clamped >= visualEnd + 0.001) {
      continue
    }
    const relativeSec = Math.min(
      Math.max(0, clamped - visualStart),
      segment.duration
    )
    return { segment, relativeSec }
  }
  return null
}
