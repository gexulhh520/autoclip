import type { EditBlock, EditSession } from '../../types/editSession'
import {
  blockPlaybackRate,
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import { buildCompositionTimeline } from '../scene/timelineLayout'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

/** Ripple 关闭时，用片段间间隙吸收时长变化，避免后续片段跟着移动 */
export function absorbBlockDurationDeltaWithGap(
  session: EditSession,
  blockIndex: number,
  oldTrim: { in_sec: number; out_sec: number },
  block: EditBlock
): void {
  if (blockIndex < 0 || blockIndex >= session.sequence.length - 1) return

  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const segment = timeline.segments[blockIndex]
  if (!segment) return

  const rate = blockPlaybackRate(block)
  const compStart = segment.compositionStartSec
  const oldVisualEnd = compStart + oldTrim.out_sec / rate
  const newVisualEnd = compStart + block.trim.out_sec / rate
  const endDelta = newVisualEnd - oldVisualEnd
  if (Math.abs(endDelta) < 0.0001) return

  const gaps = ensureSequenceBlockGaps(session)
  const gapIndex = blockIndex
  const availableGap = gaps[gapIndex] ?? 0

  if (endDelta > 0 && endDelta > availableGap + 0.001) {
    const maxOut = oldTrim.out_sec + availableGap * rate
    const inChanged = Math.abs(block.trim.in_sec - oldTrim.in_sec) > 0.0001
    const outChanged = Math.abs(block.trim.out_sec - oldTrim.out_sec) > 0.0001
    if (inChanged && !outChanged) {
      block.trim.in_sec = block.trim.out_sec - (maxOut - oldTrim.in_sec)
    } else {
      block.trim.out_sec = maxOut
    }
    gaps[gapIndex] = 0
    return
  }

  gaps[gapIndex] = Math.max(0, availableGap - endDelta)
}

/** 主轨裁切时禁止与相邻视频片段重叠（转场叠化区除外） */
export function clampVideoBlockTrimAgainstNeighbors(
  session: EditSession,
  blockIndex: number,
  block: EditBlock,
  maxDur: number
): void {
  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const segment = timeline.segments[blockIndex]
  if (!segment) return

  const rate = blockPlaybackRate(block)
  const compStart = segment.compositionStartSec
  let minIn = 0
  let maxOut = maxDur

  if (blockIndex > 0) {
    const prev = timeline.segments[blockIndex - 1]!
    const prevEnd = blockTimelineVisualEndSec(prev.compositionStartSec, prev.block)
    const minVisualStart = prevEnd - prev.dissolveOutSec
    minIn = Math.max(0, (minVisualStart - compStart) * rate)
  }

  if (blockIndex < timeline.segments.length - 1) {
    const next = timeline.segments[blockIndex + 1]!
    const nextStart = blockTimelineVisualStartSec(next.compositionStartSec, next.block)
    const trailingGap = session.sequence_block_gaps?.[blockIndex] ?? 0
    const maxVisualEnd = nextStart + segment.dissolveOutSec + trailingGap
    maxOut = Math.min(maxDur, (maxVisualEnd - compStart) * rate)
  }

  block.trim.in_sec = Math.max(minIn, Math.min(block.trim.in_sec, maxOut - 0.1))
  block.trim.out_sec = Math.max(block.trim.in_sec + 0.1, Math.min(block.trim.out_sec, maxOut))
}

export function ensureSequenceBlockGaps(session: EditSession): number[] {
  const count = Math.max(0, session.sequence.length - 1)
  if (!session.sequence_block_gaps) {
    session.sequence_block_gaps = Array.from({ length: count }, () => 0)
    return session.sequence_block_gaps
  }
  while (session.sequence_block_gaps.length < count) {
    session.sequence_block_gaps.push(0)
  }
  session.sequence_block_gaps.length = count
  return session.sequence_block_gaps
}

export function resolveSequenceBlockGaps(
  blocks: EditBlock[],
  gaps?: number[]
): number[] | undefined {
  if (!gaps?.length || blocks.length < 2) return undefined
  const normalized = gaps.slice(0, Math.max(0, blocks.length - 1))
  while (normalized.length < blocks.length - 1) {
    normalized.push(0)
  }
  return normalized
}

export function removeSequenceBlockGapAt(session: EditSession, deletedBlockIndex: number): void {
  const gaps = session.sequence_block_gaps
  if (!gaps?.length) return

  if (deletedBlockIndex <= 0) {
    gaps.splice(0, 1)
  } else if (deletedBlockIndex >= gaps.length) {
    gaps.splice(gaps.length - 1, 1)
  } else {
    const merged = (gaps[deletedBlockIndex - 1] ?? 0) + (gaps[deletedBlockIndex] ?? 0)
    gaps.splice(deletedBlockIndex - 1, 2, merged)
  }

  const expected = Math.max(0, session.sequence.length - 1)
  if (gaps.length > expected) {
    gaps.length = expected
  }
}

export function insertSequenceBlockGapAt(session: EditSession, gapIndex: number): void {
  const gaps = ensureSequenceBlockGaps(session)
  gaps.splice(gapIndex, 0, 0)
}

export function clearSequenceBlockGaps(session: EditSession): void {
  session.sequence_block_gaps = []
}