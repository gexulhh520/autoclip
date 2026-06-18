import type { AudioClipElement, EditOverlayElement, EditSession } from '../../types/editSession'
import { blockTimelineVisualEndSec, blockTimelineVisualStartSec } from '../../utils/editTimeline'
import { readNumberParam, readStringParam, writeParam } from '../opencut-text/params'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import type { CompositionSegment } from '../scene/types'
import { getTemplateBlockId, isTemplateLinkedOverlay } from '../migration/templateCaptionOverlays'
import { resolveAudioAssetCategory } from '../audioTracks'

export const TIMELINE_BLOCK_ID_PARAM = 'timeline.blockId'
export const TIMELINE_BLOCK_OFFSET_PARAM = 'timeline.blockOffsetSec'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

export function buildSessionCompositionTimeline(session: EditSession) {
  return buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
}

/** 片段在时间轴上的可视起点（含入点裁剪），联动偏移相对此位置 */
export function blockLinkAnchorSec(segment: CompositionSegment): number {
  return blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
}

export function segmentVisualEndSec(segment: CompositionSegment): number {
  return blockTimelineVisualEndSec(segment.compositionStartSec, segment.block)
}

export function findSegmentAtCompositionTime(
  session: EditSession,
  timeSec: number
): CompositionSegment | null {
  const timeline = buildSessionCompositionTimeline(session)
  if (timeline.segments.length === 0) return null

  for (const segment of timeline.segments) {
    const start = blockLinkAnchorSec(segment)
    const end = segmentVisualEndSec(segment)
    if (timeSec >= start - 0.001 && timeSec < end + 0.001) {
      return segment
    }
  }

  return timeline.segments[timeline.segments.length - 1] ?? null
}

export function getOverlayBlockLink(element: EditOverlayElement): {
  blockId: string
  offsetSec: number
} | null {
  if (isTemplateLinkedOverlay(element)) return null
  const blockId = readStringParam(element.params, TIMELINE_BLOCK_ID_PARAM, '')
  if (!blockId) return null
  const offsetSec = readNumberParam(element.params, TIMELINE_BLOCK_OFFSET_PARAM, Number.NaN)
  if (!Number.isFinite(offsetSec)) return null
  return { blockId, offsetSec }
}

export function attachOverlayBlockLink(
  session: EditSession,
  element: EditOverlayElement,
  startSec?: number
): boolean {
  if (isTemplateLinkedOverlay(element)) return false
  const anchor = startSec ?? element.start_sec
  const segment = findSegmentAtCompositionTime(session, anchor + 0.001)
  if (!segment) return false
  const offsetSec = Math.max(0, anchor - blockLinkAnchorSec(segment))
  element.params = writeParam(element.params, TIMELINE_BLOCK_ID_PARAM, segment.block.id)
  element.params = writeParam(element.params, TIMELINE_BLOCK_OFFSET_PARAM, offsetSec)
  return true
}

export function clearOverlayBlockLink(element: EditOverlayElement): boolean {
  if (isTemplateLinkedOverlay(element)) return false
  const hadLink =
    readStringParam(element.params, TIMELINE_BLOCK_ID_PARAM, '') !== '' ||
    readNumberParam(element.params, TIMELINE_BLOCK_OFFSET_PARAM, Number.NaN) !== Number.NaN
  const next = { ...element.params }
  delete next[TIMELINE_BLOCK_ID_PARAM]
  delete next[TIMELINE_BLOCK_OFFSET_PARAM]
  element.params = next
  return hadLink
}

export function attachAudioClipBlockLink(
  session: EditSession,
  clip: AudioClipElement,
  startSec?: number
): boolean {
  const anchor = startSec ?? clip.start_sec
  const segment = findSegmentAtCompositionTime(session, anchor + 0.001)
  if (!segment) return false
  clip.block_id = segment.block.id
  clip.block_offset_sec = Math.max(0, anchor - blockLinkAnchorSec(segment))
  return true
}

export function clearAudioClipBlockLink(clip: AudioClipElement): boolean {
  const hadLink = Boolean(clip.block_id) || clip.block_offset_sec != null
  delete clip.block_id
  delete clip.block_offset_sec
  return hadLink
}

export function shouldLinkAudioClip(session: EditSession, clip: AudioClipElement): boolean {
  const asset = session.audio_assets?.find((item) => item.id === clip.asset_id)
  if (!asset) return true
  return resolveAudioAssetCategory(asset) === 'sfx'
}

export function ensureBlockLinksForUnlinkedElements(session: EditSession): boolean {
  let changed = false

  for (const element of session.overlay_elements ?? []) {
    if (isTemplateLinkedOverlay(element)) continue
    if (getOverlayBlockLink(element)) continue
    if (attachOverlayBlockLink(session, element)) changed = true
  }

  for (const clip of session.audio_elements ?? []) {
    if (clip.block_id && clip.block_offset_sec != null) continue
    if (!shouldLinkAudioClip(session, clip)) continue
    if (attachAudioClipBlockLink(session, clip)) changed = true
  }

  return changed
}

/** 转场 / 叠化时长变化后，按 block 偏移重算已联动文本与音效的起始时间 */
export function reconcileTimelineBlockLinks(session: EditSession): boolean {
  const timeline = buildSessionCompositionTimeline(session)
  let changed = false

  for (const element of session.overlay_elements ?? []) {
    if (isTemplateLinkedOverlay(element)) continue
    const link = getOverlayBlockLink(element)
    if (!link) continue
    const segment = timeline.segments.find((item) => item.block.id === link.blockId)
    if (!segment) continue
    const nextStart = blockLinkAnchorSec(segment) + link.offsetSec
    if (Math.abs(element.start_sec - nextStart) > 0.001) {
      element.start_sec = nextStart
      changed = true
    }
  }

  for (const clip of session.audio_elements ?? []) {
    if (!clip.block_id || clip.block_offset_sec == null) continue
    if (!shouldLinkAudioClip(session, clip)) continue
    const segment = timeline.segments.find((item) => item.block.id === clip.block_id)
    if (!segment) continue
    const nextStart = blockLinkAnchorSec(segment) + clip.block_offset_sec
    if (Math.abs(clip.start_sec - nextStart) > 0.001) {
      clip.start_sec = nextStart
      changed = true
    }
  }

  return changed
}

const MIN_LINKED_ELEMENT_SEC = 0.2

/**
 * 主轨尾部缩短时：若旧出点落在文本/音效范围内，则同步从尾部缩短相同时长；
 * 再次拉长视频时不恢复（只处理 delta > 0）。
 * 归属：元素起点落在哪个视频片段可视范围内，即归属该片段。
 */
export function applyTailTrimLinkedElements(
  session: EditSession,
  blockId: string,
  oldVisualEnd: number,
  newVisualEnd: number
): boolean {
  const delta = oldVisualEnd - newVisualEnd
  if (delta <= 0.001) return false

  let changed = false

  for (const element of session.overlay_elements ?? []) {
    if (isTemplateLinkedOverlay(element)) continue
    const owner = findSegmentAtCompositionTime(session, element.start_sec + 0.001)
    if (owner?.block.id !== blockId) continue

    const elementStart = element.start_sec
    const elementEnd = elementStart + element.duration_sec
    if (oldVisualEnd <= elementStart + 0.001 || oldVisualEnd > elementEnd + 0.001) continue

    const nextDuration = Math.max(MIN_LINKED_ELEMENT_SEC, element.duration_sec - delta)
    if (Math.abs(nextDuration - element.duration_sec) > 0.001) {
      element.duration_sec = nextDuration
      changed = true
    }
  }

  for (const clip of session.audio_elements ?? []) {
    if (!shouldLinkAudioClip(session, clip)) continue
    const owner = findSegmentAtCompositionTime(session, clip.start_sec + 0.001)
    if (owner?.block.id !== blockId) continue

    const clipStart = clip.start_sec
    const clipEnd = clipStart + clip.duration_sec
    if (oldVisualEnd <= clipStart + 0.001 || oldVisualEnd > clipEnd + 0.001) continue

    const nextDuration = Math.max(MIN_LINKED_ELEMENT_SEC, clip.duration_sec - delta)
    if (Math.abs(nextDuration - clip.duration_sec) > 0.001) {
      const trimStart = clip.trim_start_sec ?? 0
      clip.duration_sec = nextDuration
      if (clip.trim_end_sec != null) {
        clip.trim_end_sec = Math.max(trimStart + MIN_LINKED_ELEMENT_SEC, clip.trim_end_sec - delta)
      }
      changed = true
    }
  }

  return changed
}
