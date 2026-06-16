import type { EditSession } from '../../types/editSession'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { blockDuration } from '../../utils/editTimeline'
import { getTemplateBlockId } from './templateCaptionOverlays'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings.transition_duration_sec ?? 0.35

/** 主轨插入视频后，将插入点之后的自由文本/音频/书签顺延，模板字幕由 ensureTemplateCaptionOverlays 按 block 重算 */
export function shiftTimelineElementsAfterVideoInsert(
  session: EditSession,
  insertIndex: number,
  addedCount: number
): boolean {
  if (addedCount <= 0 || insertIndex < 0 || !session.sequence.length) return false

  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec(session))
  const insertSegment = timeline.segments[insertIndex]
  if (!insertSegment) return false

  const insertCompositionStart = insertSegment.compositionStartSec
  const insertedBlocks = session.sequence.slice(insertIndex, insertIndex + addedCount)
  if (insertedBlocks.length === 0) return false

  const insertedDuration = insertedBlocks.reduce((sum, block) => sum + blockDuration(block), 0)
  if (insertedDuration <= 0) return false

  let changed = false

  for (const element of session.overlay_elements ?? []) {
    if (getTemplateBlockId(element)) continue
    if (element.start_sec >= insertCompositionStart - 0.001) {
      element.start_sec += insertedDuration
      changed = true
    }
  }

  for (const clip of session.audio_elements ?? []) {
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
