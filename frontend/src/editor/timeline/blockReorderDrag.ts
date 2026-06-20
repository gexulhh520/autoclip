import type { EditBlock } from '../../types/editSession'
import {
  buildCompositionTimelineSegments,
  type CompositionTimelineSegment,
} from '../scene/timelineLayout'

export function previewBlockOrder<T>(items: T[], fromIndex: number, targetIndex: number): T[] {
  if (fromIndex === targetIndex) return [...items]
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

/** 根据指针在合成时间轴上的位置，计算 splice 重排目标下标（基于拖拽开始时的 segments 快照） */
export function resolveBlockReorderTargetIndex(
  pointerSec: number,
  fromIndex: number,
  segments: CompositionTimelineSegment[]
): number {
  if (segments.length <= 1) return fromIndex

  let insertBefore = segments.length
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const midpoint = segment.startSec + segment.duration / 2
    if (pointerSec < midpoint) {
      insertBefore = index
      break
    }
  }

  if (fromIndex < insertBefore) return insertBefore - 1
  return insertBefore
}

export function computeBlockInsertMarkerSec(
  blocks: EditBlock[],
  fromIndex: number,
  targetIndex: number,
  transitionDurationSec: number,
  blockGaps?: number[]
): number {
  const previewBlocks = previewBlockOrder(blocks, fromIndex, targetIndex)
  const previewGaps =
    blockGaps && blockGaps.length === blocks.length
      ? previewBlockOrder(blockGaps, fromIndex, targetIndex)
      : blockGaps
  const previewSegments = buildCompositionTimelineSegments(
    previewBlocks,
    1,
    transitionDurationSec,
    previewGaps
  )
  const targetSegment = previewSegments[targetIndex]
  if (targetSegment) return targetSegment.startSec
  const last = previewSegments[previewSegments.length - 1]
  return last?.endSec ?? 0
}
