import type { EditSession } from '../../types/editSession'
import { blockPlaybackRate, blockTimelineVisualStartSec } from '../../utils/editTimeline'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { resolveMainTrackSequentialBlocks } from '../videoTracks'
import {
  dropCrossTransitionsBrokenByGaps,
  ensureSequenceBlockGaps,
} from './sequenceBlockGaps'

export interface MainTrackGapDragBaseline {
  gaps: number[]
  trimInByBlockId: Map<string, number>
}

export function captureMainTrackGapBaseline(session: EditSession): MainTrackGapDragBaseline {
  return {
    gaps: [...ensureSequenceBlockGaps(session)],
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
    session.sequence_block_gaps
  )
  const segment = timeline.segments[mainIndex]
  if (!segment) return null
  return blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
}

/** 将主轨顺序片段拖到目标可视起点（通过 gap 转移或首段 trim.in） */
export function setMainTrackBlockVisualStart(
  session: EditSession,
  blockId: string,
  targetVisualStartSec: number,
  baseline: MainTrackGapDragBaseline,
  options?: { ripple?: boolean }
): boolean {
  restoreMainTrackGapBaseline(session, baseline)
  const current = resolveMainTrackBlockVisualStartSec(session, blockId)
  if (current == null) return false
  const deltaSec = targetVisualStartSec - current
  return applyMainTrackBlockVisualShift(session, blockId, deltaSec, options)
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
  if (Math.abs(applied) < 0.0001) return false

  gaps[seqIndex - 1] = before + applied
  if (after != null) gaps[seqIndex] = after - applied

  dropCrossTransitionsBrokenByGaps(session)
  return true
}
