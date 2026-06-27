import type { EditSession } from '../../types/editSession'
import { blockDuration } from '../../utils/editTimeline'
import { buildDefaultOverlayPictureInPictureTransform } from '../../utils/blockVideoTransform'
import { isMainTrackBlock } from '../videoTracks'
import {
  clampStartAvoidingOverlap,
  getVideoBlockSiblingRanges,
} from './timelineOverlap'
import { preserveMainTrackTimingGapForOverlayMove } from './sequenceBlockGaps'

/** 主轨顺序片段拖到叠画轨时的落点 clamp（不含自身） */
export function clampMainBlockOverlayDropStartSec(
  session: EditSession,
  blockId: string,
  overlayTrackId: string,
  proposedStartSec: number
): number {
  const block = session.sequence.find((item) => item.id === blockId)
  if (!block) return Math.max(0, proposedStartSec)
  const siblings = getVideoBlockSiblingRanges(session, overlayTrackId, blockId)
  return clampStartAvoidingOverlap(siblings, blockDuration(block), proposedStartSec)
}

/**
 * 主轨顺序片段 → 叠画轨（单次写入）：
 * - 主轨保留原时段空隙，后续片段不整体漂移
 * - 设置 timeline_start_sec 与默认 PiP transform
 */
export function applyMainSequentialBlockMoveToOverlay(
  session: EditSession,
  blockId: string,
  overlayTrackId: string,
  overlayStartSec: number
): boolean {
  const seqIndex = session.sequence.findIndex((item) => item.id === blockId)
  if (seqIndex < 0) return false
  const block = session.sequence[seqIndex]!
  if (!isMainTrackBlock(block) || block.timeline_start_sec != null) return false

  preserveMainTrackTimingGapForOverlayMove(
    session,
    seqIndex,
    blockDuration(block)
  )

  block.track_id = overlayTrackId
  block.timeline_start_sec = Math.max(0, overlayStartSec)
  block.video_transform = buildDefaultOverlayPictureInPictureTransform(
    session.export_settings
  )
  return true
}
