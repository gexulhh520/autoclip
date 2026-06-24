import type { EditSession } from '../../types/editSession'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { blockDuration } from '../../utils/editTimeline'
import { isMainTrackBlock } from '../videoTracks'
import { getOverlayBlockLink } from '../timeline/timelineBlockLink'
import { getTemplateBlockId } from './templateCaptionOverlays'

export interface ShiftTimelineAfterInsertOptions {
  /** 与工具栏「片段联动」一致；关闭时不顺延文本/音频 */
  linkEnabled?: boolean
}

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings.transition_duration_sec ?? 0.35

function resolveMainTrackInsertIndex(session: EditSession, sequenceInsertIndex: number): number {
  let mainIndex = 0
  for (let i = 0; i < sequenceInsertIndex && i < session.sequence.length; i += 1) {
    if (isMainTrackBlock(session.sequence[i]!)) {
      mainIndex += 1
    }
  }
  return mainIndex
}

/** 主轨中间插入视频后，将插入点之后的自由文本/音频/书签顺延；模板字幕由 ensureTemplateCaptionOverlays 按 block 重算 */
export function shiftTimelineElementsAfterVideoInsert(
  session: EditSession,
  insertIndex: number,
  addedCount: number,
  options?: ShiftTimelineAfterInsertOptions
): boolean {
  if (options?.linkEnabled === false) return false
  if (addedCount <= 0 || insertIndex < 0 || !session.sequence.length) return false

  const isAppend = insertIndex >= session.sequence.length - addedCount
  if (isAppend) return false

  const hadMainTrackBeforeInsert = session.sequence
    .slice(0, insertIndex)
    .some(isMainTrackBlock)
  if (!hadMainTrackBeforeInsert) return false

  const mainTrackBlocks = session.sequence.filter(isMainTrackBlock)
  const mainInsertIndex = resolveMainTrackInsertIndex(session, insertIndex)
  const timeline = buildCompositionTimeline(
    mainTrackBlocks,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const insertSegment = timeline.segments[mainInsertIndex]
  if (!insertSegment) return false

  const insertCompositionStart = insertSegment.compositionStartSec
  const insertedBlocks = mainTrackBlocks.slice(mainInsertIndex, mainInsertIndex + addedCount)
  if (insertedBlocks.length === 0) return false

  const insertedDuration = insertedBlocks.reduce((sum, block) => sum + blockDuration(block), 0)
  if (insertedDuration <= 0) return false

  let changed = false

  for (const element of session.overlay_elements ?? []) {
    if (getTemplateBlockId(element)) continue
    if (getOverlayBlockLink(element)) continue
    if (element.start_sec >= insertCompositionStart - 0.001) {
      element.start_sec += insertedDuration
      changed = true
    }
  }

  for (const clip of session.audio_elements ?? []) {
    if (clip.block_id) continue
    if (clip.start_sec >= insertCompositionStart - 0.001) {
      clip.start_sec += insertedDuration
      changed = true
    }
  }

  for (const bookmark of session.bookmarks ?? []) {
    if (bookmark.time_sec >= insertCompositionStart - 0.001) {
      bookmark.time_sec += insertedDuration
      changed = true
    }
  }

  return changed
}
