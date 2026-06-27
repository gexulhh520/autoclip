import type { EditSession } from '../../types/editSession'
import { blockDuration, blockTimelineVisualStartSec } from '../../utils/editTimeline'
import {
  DEFAULT_BLOCK_VIDEO_TRANSFORM,
  isFullScreenBlockVideoTransform,
} from '../../utils/blockVideoTransform'
import {
  DEFAULT_VIDEO_TRACK_ID,
  isMainTrackBlock,
  resolveMainTrackSequentialBlocks,
} from '../videoTracks'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import {
  clampStartAvoidingOverlap,
  getVideoBlockSiblingRanges,
} from './timelineOverlap'
import {
  ensureSequenceBlockGaps,
  normalizeOverlayVideoBlocksToSequenceEnd,
  preserveMainTrackTimingGapForOverlayMove,
  readSequenceBlockGaps,
  removeSequenceBlockGapAt,
  resolveMainTrackCompositionGaps,
} from './sequenceBlockGaps'
import { resolveMainTrackBlockVisualStartSec } from './mainTrackBlockGapDrag'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

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

/** 主轨→叠画：默认落在原 composition 可视起点，再按叠画轨 sibling clamp */
export function resolveMainTrackOverlayDropStartSec(
  session: EditSession,
  blockId: string,
  overlayTrackId: string,
  proposedStartSec?: number
): number {
  const anchor = resolveMainTrackBlockVisualStartSec(session, blockId) ?? 0
  return clampMainBlockOverlayDropStartSec(
    session,
    blockId,
    overlayTrackId,
    proposedStartSec ?? anchor
  )
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
  overlayStartSec?: number
): boolean {
  const seqIndex = session.sequence.findIndex((item) => item.id === blockId)
  if (seqIndex < 0) return false
  const block = session.sequence[seqIndex]!
  if (!isMainTrackBlock(block) || block.timeline_start_sec != null) return false

  const startSec = resolveMainTrackOverlayDropStartSec(
    session,
    blockId,
    overlayTrackId,
    overlayStartSec
  )

  preserveMainTrackTimingGapForOverlayMove(
    session,
    seqIndex,
    blockDuration(block)
  )

  block.track_id = overlayTrackId
  block.timeline_start_sec = startSec
  if (
    !block.video_transform ||
    isFullScreenBlockVideoTransform(block.video_transform)
  ) {
    block.video_transform = { ...DEFAULT_BLOCK_VIDEO_TRANSFORM }
  }

  session.sequence.splice(seqIndex, 1)
  session.sequence.push(block)
  normalizeOverlayVideoBlocksToSequenceEnd(session)

  return true
}

/** 根据落点时间确定主轨顺序片段的插入序号 */
export function resolveMainSequentialInsertIndexFromStartSec(
  session: EditSession,
  proposedStartSec: number
): number {
  const mainBlocks = resolveMainTrackSequentialBlocks(session)
  if (mainBlocks.length === 0) return 0

  const timeline = buildCompositionTimeline(
    mainBlocks,
    transitionDurationSec(session),
    resolveMainTrackCompositionGaps(session, mainBlocks)
  )

  for (let index = 0; index < timeline.segments.length; index += 1) {
    const segment = timeline.segments[index]!
    const visualStart = blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
    if (proposedStartSec < visualStart + 0.001) return index
  }
  return mainBlocks.length
}

function sumSequenceGapsBetween(
  gaps: number[],
  fromSeqIndex: number,
  toSeqIndex: number
): number {
  if (fromSeqIndex < 0 || toSeqIndex <= fromSeqIndex) return 0
  let total = 0
  for (let index = fromSeqIndex; index < toSeqIndex; index += 1) {
    total += gaps[index] ?? 0
  }
  return total
}

/**
 * 叠画轨视频 → 主轨顺序片段（单次写入）：
 * - 插入到落点对应的主轨顺序位置
 * - 消耗移走主轨时保留的空隙，后续片段不整体漂移
 */
export function applyOverlayBlockMoveToMainSequential(
  session: EditSession,
  blockId: string,
  proposedStartSec?: number
): boolean {
  const seqIndex = session.sequence.findIndex((item) => item.id === blockId)
  if (seqIndex < 0) return false
  const block = session.sequence[seqIndex]!
  if (isMainTrackBlock(block) && block.timeline_start_sec == null) return false

  const insertMainIndex = resolveMainSequentialInsertIndexFromStartSec(
    session,
    proposedStartSec ?? block.timeline_start_sec ?? 0
  )

  const mainBlocksBefore = resolveMainTrackSequentialBlocks(session)
  const prevMain = insertMainIndex > 0 ? mainBlocksBefore[insertMainIndex - 1] : null
  const nextMain =
    insertMainIndex < mainBlocksBefore.length ? mainBlocksBefore[insertMainIndex] : null
  const prevSeqIdx = prevMain
    ? session.sequence.findIndex((item) => item.id === prevMain.id)
    : -1
  const nextSeqIdx = nextMain
    ? session.sequence.findIndex((item) => item.id === nextMain.id)
    : session.sequence.length

  const fullGaps = readSequenceBlockGaps(session)
  const preservedGapTotal =
    prevSeqIdx >= 0
      ? sumSequenceGapsBetween(fullGaps, prevSeqIdx, nextSeqIdx)
      : 0
  const blockDur = blockDuration(block)
  const trailingGapAfterInsert = Math.max(0, preservedGapTotal - blockDur)

  session.sequence.splice(seqIndex, 1)
  removeSequenceBlockGapAt(session, seqIndex)

  let insertSeqIndex = 0
  if (prevMain) {
    insertSeqIndex = session.sequence.findIndex((item) => item.id === prevMain.id) + 1
  } else if (nextMain) {
    insertSeqIndex = session.sequence.findIndex((item) => item.id === nextMain.id)
  }

  block.track_id = DEFAULT_VIDEO_TRACK_ID
  delete block.timeline_start_sec
  block.video_transform = { ...DEFAULT_BLOCK_VIDEO_TRANSFORM }

  session.sequence.splice(insertSeqIndex, 0, block)
  normalizeOverlayVideoBlocksToSequenceEnd(session)

  const mainBlocks = resolveMainTrackSequentialBlocks(session)
  const mainIndex = mainBlocks.findIndex((item) => item.id === blockId)
  if (mainIndex < 0) return false

  const gaps = ensureSequenceBlockGaps(session)
  if (mainIndex > 0) {
    gaps[mainIndex - 1] = 0
  }
  if (mainIndex < mainBlocks.length - 1) {
    gaps[mainIndex] = trailingGapAfterInsert
  }

  return true
}
