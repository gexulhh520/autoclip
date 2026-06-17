import type { EditBlock, EditSession } from '../../types/editSession'
import { blockDuration } from '../../utils/editTimeline'

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

/** Ripple 关闭时，用片段间间隙吸收时长变化，避免后续片段跟着移动 */
export function absorbBlockDurationDeltaWithGap(
  session: EditSession,
  blockIndex: number,
  oldTrim: { in_sec: number; out_sec: number },
  block: EditBlock
): void {
  if (blockIndex < 0 || blockIndex >= session.sequence.length - 1) return

  const rate =
    block.playback_rate && block.playback_rate > 0
      ? Math.min(4, Math.max(0.25, block.playback_rate))
      : 1
  const oldDurationSec = (oldTrim.out_sec - oldTrim.in_sec) / rate
  const gaps = ensureSequenceBlockGaps(session)
  const gapIndex = blockIndex
  const availableGap = gaps[gapIndex] ?? 0
  const newDurationSec = blockDuration(block)
  const durationDelta = newDurationSec - oldDurationSec
  if (Math.abs(durationDelta) < 0.0001) return

  if (durationDelta > 0 && durationDelta > availableGap + 0.001) {
    const maxSpan = (oldDurationSec + availableGap) * rate
    const inChanged = Math.abs(block.trim.in_sec - oldTrim.in_sec) > 0.0001
    const outChanged = Math.abs(block.trim.out_sec - oldTrim.out_sec) > 0.0001
    if (inChanged && !outChanged) {
      block.trim.in_sec = block.trim.out_sec - maxSpan
    } else if (outChanged && !inChanged) {
      block.trim.out_sec = block.trim.in_sec + maxSpan
    } else {
      block.trim.out_sec = block.trim.in_sec + maxSpan
    }
    gaps[gapIndex] = 0
    return
  }

  gaps[gapIndex] = Math.max(0, availableGap - durationDelta)
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
