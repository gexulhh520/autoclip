import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import {
  blockPlaybackRate,
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import {
  isMainTrackBlock,
  resolveMainTrackSequentialBlocks,
} from '../videoTracks'

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

/** 主轨裁切时禁止与相邻视频片段重叠 */
export function applyVideoHeadTrimClamp(
  session: EditSession,
  blockIndex: number,
  block: EditBlock,
  options?: { rippleEnabled?: boolean; fixedOutSec?: number; proposedVisualStartSec?: number }
): void {
  const fixedOutSec = options?.fixedOutSec ?? block.trim.out_sec
  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const segment = timeline.segments[blockIndex]
  if (!segment) return

  const rate = blockPlaybackRate(block)
  let compStart = segment.compositionStartSec

  let minVisualStart = 0
  if (blockIndex > 0) {
    const prev = timeline.segments[blockIndex - 1]!
    minVisualStart = blockTimelineVisualEndSec(prev.compositionStartSec, prev.block)
  }

  let visualStart =
    options?.proposedVisualStartSec ?? compStart + block.trim.in_sec / rate

  if (!options?.rippleEnabled && blockIndex > 0 && visualStart < compStart - 0.001) {
    const gaps = ensureSequenceBlockGaps(session)
    const gapIdx = blockIndex - 1
    const targetStart = Math.max(minVisualStart, visualStart)
    const shrinkBy = Math.min(gaps[gapIdx] ?? 0, compStart - targetStart)
    if (shrinkBy > 0) {
      gaps[gapIdx] = Math.max(0, (gaps[gapIdx] ?? 0) - shrinkBy)
      const timelineAfterGap = buildCompositionTimeline(
        session.sequence,
        transitionDurationSec(session),
        session.sequence_block_gaps
      )
      compStart = timelineAfterGap.segments[blockIndex]!.compositionStartSec
      visualStart = compStart + block.trim.in_sec / rate
    }
  }

  visualStart = Math.max(minVisualStart, visualStart)

  const maxIn = fixedOutSec - 0.1
  block.trim.in_sec = Math.max(0, Math.min((visualStart - compStart) * rate, maxIn))
  block.trim.out_sec = fixedOutSec
}

export function applyVideoTailTrimClamp(
  session: EditSession,
  blockIndex: number,
  block: EditBlock,
  maxDur: number,
  options?: { proposedVisualEndSec?: number }
): void {
  const fixedInSec = block.trim.in_sec
  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const segment = timeline.segments[blockIndex]
  if (!segment) return

  const rate = blockPlaybackRate(block)
  const compStart = segment.compositionStartSec
  const minVisualEnd = compStart + fixedInSec / rate + 0.1 / rate
  let maxVisualEnd = compStart + maxDur / rate

  if (blockIndex < timeline.segments.length - 1) {
    const next = timeline.segments[blockIndex + 1]!
    const nextStart = blockTimelineVisualStartSec(next.compositionStartSec, next.block)
    const trailingGap = session.sequence_block_gaps?.[blockIndex] ?? 0
    maxVisualEnd = nextStart + trailingGap
  }

  let visualEnd =
    options?.proposedVisualEndSec ?? compStart + block.trim.out_sec / rate
  visualEnd = Math.max(minVisualEnd, Math.min(visualEnd, maxVisualEnd))
  block.trim.in_sec = fixedInSec
  block.trim.out_sec = Math.max(fixedInSec + 0.1, Math.min((visualEnd - compStart) * rate, maxDur))
}

export function clampVideoBlockTrimAgainstNeighbors(
  session: EditSession,
  blockIndex: number,
  block: EditBlock,
  maxDur: number
): void {
  applyVideoHeadTrimClamp(session, blockIndex, block)
  applyVideoTailTrimClamp(session, blockIndex, block, maxDur)
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

/**
 * 主轨片段移到叠画轨后，在原位置保留等长空隙，避免后续主轨片段整体前移。
 */
export function preserveMainTrackTimingGapForOverlayMove(
  session: EditSession,
  blockIndex: number,
  removedDurationSec: number
): void {
  removeSequenceBlockGapAt(session, blockIndex)
  const gaps = ensureSequenceBlockGaps(session)
  const gapIdx = Math.max(0, blockIndex - 1)
  if (gapIdx < gaps.length) {
    gaps[gapIdx] = (gaps[gapIdx] ?? 0) + Math.max(0, removedDurationSec)
  }
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

/** 相邻主轨片段的可视间距（秒）：>0 表示两段之间有缝，不能叠化转场 */
export function mainTrackSegmentSeparationSec(
  session: EditSession,
  outgoingIndex: number
): number | null {
  if (outgoingIndex < 0 || outgoingIndex >= session.sequence.length - 1) return null

  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const outgoing = timeline.segments[outgoingIndex]
  const incoming = timeline.segments[outgoingIndex + 1]
  if (!outgoing || !incoming) return null

  const prevEnd = blockTimelineVisualEndSec(outgoing.compositionStartSec, outgoing.block)
  const nextStart = blockTimelineVisualStartSec(incoming.compositionStartSec, incoming.block)
  return nextStart - prevEnd
}

/** 两段主轨视频首尾相接（无间隙），才允许添加转场 */
export function areMainTrackBlocksAdjacent(
  session: EditSession,
  outgoingIndex: number,
  toleranceSec = 0.001
): boolean {
  const separation = mainTrackSegmentSeparationSec(session, outgoingIndex)
  return separation != null && separation <= toleranceSec
}

/**
 * 主轨磁吸关闭时：相邻片段可视间距超过叠化区则移除转场（硬切），且不自动恢复。
 * 开启磁吸时片段间距由 ripple 维持，通常不会触发。
 */
export function dropCrossTransitionsBrokenByGaps(session: EditSession): boolean {
  if (session.sequence.length < 2) return false

  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  let changed = false

  for (let index = 0; index < timeline.segments.length - 1; index += 1) {
    const outgoing = timeline.segments[index]!
    if (!isCrossTransition(outgoing.block.transition_out)) continue

    const separationSec = mainTrackSegmentSeparationSec(session, index)
    if (separationSec != null && separationSec > 0.001) {
      outgoing.block.transition_out = 'cut'
      changed = true
    }
  }

  return changed
}

export function isMainTrackSequentialBlock(block: EditBlock): boolean {
  return isMainTrackBlock(block) && block.timeline_start_sec == null
}

/** 主轨顺序片段之间的有效 composition 间距（累加 sequence 中间所有 gap） */
export function resolveMainTrackCompositionGaps(
  session: EditSession,
  mainBlocks: EditBlock[] = resolveMainTrackSequentialBlocks(session)
): number[] | undefined {
  if (mainBlocks.length < 2) return undefined

  const fullGaps = ensureSequenceBlockGaps(session)
  const result: number[] = []

  for (let i = 1; i < mainBlocks.length; i++) {
    const prevIdx = session.sequence.findIndex((item) => item.id === mainBlocks[i - 1]!.id)
    const nextIdx = session.sequence.findIndex((item) => item.id === mainBlocks[i]!.id)
    if (prevIdx < 0 || nextIdx < 0 || nextIdx <= prevIdx) {
      result.push(0)
      continue
    }
    let gapTotal = 0
    for (let j = prevIdx; j < nextIdx; j++) {
      gapTotal += fullGaps[j] ?? 0
    }
    result.push(gapTotal)
  }
  return result
}

/**
 * 叠画视频块不应插在主轨顺序片段中间，否则 sequence_block_gaps 与主轨 composition 错位。
 * 将非主轨顺序块移到 sequence 末尾并重建 gaps。
 */
export function normalizeOverlayVideoBlocksToSequenceEnd(session: EditSession): boolean {
  const sequential = resolveMainTrackSequentialBlocks(session)
  if (sequential.length === 0) return false

  const lastSequentialIndex = Math.max(
    ...sequential.map((block) => session.sequence.findIndex((item) => item.id === block.id))
  )

  const hasIntruder = session.sequence.some(
    (block, index) => index < lastSequentialIndex && !isMainTrackSequentialBlock(block)
  )
  if (!hasIntruder) return false

  const derivedGaps = resolveMainTrackCompositionGaps(session, sequential) ?? []
  const tail = session.sequence.filter((block) => !isMainTrackSequentialBlock(block))

  session.sequence = [...sequential, ...tail]
  session.sequence_block_gaps = [
    ...derivedGaps,
    ...Array.from({ length: Math.max(0, tail.length) }, () => 0),
  ]
  return true
}