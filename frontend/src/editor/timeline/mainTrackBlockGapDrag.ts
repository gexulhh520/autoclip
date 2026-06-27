import type { EditSession } from '../../types/editSession'
import {
  blockDuration,
  blockPlaybackRate,
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { resolveMainTrackSequentialBlocks } from '../videoTracks'
import {
  dropCrossTransitionsBrokenByGaps,
  ensureSequenceBlockGaps,
  resolveMainTrackCompositionGaps,
} from './sequenceBlockGaps'

export interface MainTrackGapDragBaseline {
  gaps: number[]
  trimInByBlockId: Map<string, number>
}

export function captureMainTrackGapBaseline(session: EditSession): MainTrackGapDragBaseline {
  const count = Math.max(0, session.sequence.length - 1)
  const existing = session.sequence_block_gaps
  const gaps =
    existing && existing.length >= count
      ? existing.slice(0, count)
      : Array.from({ length: count }, (_, index) => existing?.[index] ?? 0)

  return {
    gaps,
    trimInByBlockId: new Map(
      resolveMainTrackSequentialBlocks(session).map((block) => [
        block.id,
        block.trim.in_sec,
      ])
    ),
  }
}

export function restoreMainTrackGapBaseline(
  session: EditSession,
  baseline: MainTrackGapDragBaseline
): void {
  session.sequence_block_gaps = [...baseline.gaps]
  for (const [blockId, trimIn] of baseline.trimInByBlockId) {
    const block = session.sequence.find((item) => item.id === blockId)
    if (block) block.trim.in_sec = trimIn
  }
}

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

export function resolveMainTrackBlockVisualStartSec(
  session: EditSession,
  blockId: string
): number | null {
  const mainBlocks = resolveMainTrackSequentialBlocks(session)
  const mainIndex = mainBlocks.findIndex((block) => block.id === blockId)
  if (mainIndex < 0) return null
  const timeline = buildCompositionTimeline(
    mainBlocks,
    transitionDurationSec(session),
    resolveMainTrackCompositionGaps(session, mainBlocks)
  )
  const segment = timeline.segments[mainIndex]
  if (!segment) return null
  return blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
}

/** 将主轨顺序片段拖到目标可视起点（绝对定位，松手位置即提交位置） */
export function setMainTrackBlockVisualStart(
  session: EditSession,
  blockId: string,
  targetVisualStartSec: number,
  baseline: MainTrackGapDragBaseline,
  options?: { ripple?: boolean }
): boolean {
  return applyMainTrackBlockAbsoluteVisualStart(
    session,
    blockId,
    targetVisualStartSec,
    baseline,
    options
  )
}

/** 按目标可视起点直接写入 gap / trim.in（比 delta 增量更准） */
export function clampMainTrackBlockVisualStartTarget(
  session: EditSession,
  blockId: string,
  targetVisualStartSec: number,
  options?: { ripple?: boolean }
): number {
  const mainBlocks = resolveMainTrackSequentialBlocks(session)
  const mainIndex = mainBlocks.findIndex((block) => block.id === blockId)
  if (mainIndex < 0) return Math.max(0, targetVisualStartSec)

  const block = session.sequence.find((item) => item.id === blockId)
  if (!block) return Math.max(0, targetVisualStartSec)

  const rate = blockPlaybackRate(block)
  const timeline = buildCompositionTimeline(
    mainBlocks,
    transitionDurationSec(session),
    resolveMainTrackCompositionGaps(session, mainBlocks)
  )
  const segment = timeline.segments[mainIndex]
  if (!segment) return Math.max(0, targetVisualStartSec)

  const currentStart = blockTimelineVisualStartSec(segment.compositionStartSec, block)
  let target = Math.max(0, targetVisualStartSec)
  const visualDuration = blockDuration(block)

  if (mainIndex === 0) {
    const maxTrimIn = block.trim.out_sec - 0.1 * rate
    const trimIn = Math.max(0, Math.min(maxTrimIn, target * rate))
    return trimIn / rate
  }

  const prevSeg = timeline.segments[mainIndex - 1]!
  const minStart = blockTimelineVisualEndSec(prevSeg.compositionStartSec, prevSeg.block)
  target = Math.max(minStart, target)

  if (mainIndex < timeline.segments.length - 1) {
    const nextSeg = timeline.segments[mainIndex + 1]!
    const nextStart = blockTimelineVisualStartSec(nextSeg.compositionStartSec, nextSeg.block)
    const maxStart = nextStart - visualDuration + 0.0001
    target = Math.min(target, maxStart)
  }

  return target
}

export function applyMainTrackBlockAbsoluteVisualStart(
  session: EditSession,
  blockId: string,
  targetVisualStartSec: number,
  baseline: MainTrackGapDragBaseline,
  options?: { ripple?: boolean }
): boolean {
  restoreMainTrackGapBaseline(session, baseline)

  const mainBlocks = resolveMainTrackSequentialBlocks(session)
  const mainIndex = mainBlocks.findIndex((block) => block.id === blockId)
  if (mainIndex < 0) return false

  const seqIndex = session.sequence.findIndex((item) => item.id === blockId)
  if (seqIndex < 0) return false
  const block = session.sequence[seqIndex]!
  const rate = blockPlaybackRate(block)
  const gaps = ensureSequenceBlockGaps(session)

  const timeline = buildCompositionTimeline(
    mainBlocks,
    transitionDurationSec(session),
    resolveMainTrackCompositionGaps(session, mainBlocks)
  )
  const segment = timeline.segments[mainIndex]
  if (!segment) return false

  const currentStart = blockTimelineVisualStartSec(segment.compositionStartSec, block)
  let target = clampMainTrackBlockVisualStartTarget(
    session,
    blockId,
    targetVisualStartSec,
    options
  )
  const visualDuration = blockDuration(block)

  if (mainIndex === 0) {
    const maxTrimIn = block.trim.out_sec - 0.1 * rate
    const trimIn = Math.max(0, Math.min(maxTrimIn, target * rate))
    if (Math.abs(trimIn - block.trim.in_sec) < 0.0001) return false
    block.trim.in_sec = trimIn
    dropCrossTransitionsBrokenByGaps(session)
    return true
  }

  const prevSeg = timeline.segments[mainIndex - 1]!
  if (Math.abs(target - currentStart) < 0.0001) return false

  const prevEnd = blockTimelineVisualEndSec(prevSeg.compositionStartSec, prevSeg.block)
  const targetCompStart = target - block.trim.in_sec / rate
  gaps[seqIndex - 1] = Math.max(0, targetCompStart - prevEnd)

  const nextSeg =
    mainIndex < timeline.segments.length - 1 ? timeline.segments[mainIndex + 1] : null

  if (nextSeg && !options?.ripple) {
    const nextCompStart = nextSeg.compositionStartSec
    gaps[seqIndex] = Math.max(0, nextCompStart - (target + visualDuration))
  }

  dropCrossTransitionsBrokenByGaps(session)
  return true
}

export function applyMainTrackBlockVisualShift(
  session: EditSession,
  blockId: string,
  deltaSec: number,
  options?: { ripple?: boolean }
): boolean {
  if (Math.abs(deltaSec) < 0.0001) return false

  const seqIndex = session.sequence.findIndex((item) => item.id === blockId)
  if (seqIndex < 0) return false
  const block = session.sequence[seqIndex]!
  const mainBlocks = resolveMainTrackSequentialBlocks(session)
  const mainIndex = mainBlocks.findIndex((item) => item.id === blockId)
  if (mainIndex < 0) return false

  const rate = blockPlaybackRate(block)
  const gaps = ensureSequenceBlockGaps(session)
  const count = session.sequence.length

  if (mainIndex === 0) {
    const maxTrimIn = block.trim.out_sec - 0.1 * rate
    const nextTrimIn = Math.max(
      0,
      Math.min(maxTrimIn, block.trim.in_sec + deltaSec * rate)
    )
    if (Math.abs(nextTrimIn - block.trim.in_sec) < 0.0001) return false
    block.trim.in_sec = nextTrimIn
    dropCrossTransitionsBrokenByGaps(session)
    return true
  }

  if (options?.ripple) {
    gaps[seqIndex - 1] = Math.max(0, (gaps[seqIndex - 1] ?? 0) + deltaSec)
    dropCrossTransitionsBrokenByGaps(session)
    return true
  }

  const before = gaps[seqIndex - 1] ?? 0
  const after = seqIndex < count - 1 ? (gaps[seqIndex] ?? 0) : null

  let applied = deltaSec
  applied = Math.max(-before, applied)
  if (after != null) applied = Math.min(after, applied)

  if (Math.abs(applied) >= 0.0001) {
    gaps[seqIndex - 1] = before + applied
    if (after != null) gaps[seqIndex] = after - applied
    dropCrossTransitionsBrokenByGaps(session)
    return true
  }

  return false
}
