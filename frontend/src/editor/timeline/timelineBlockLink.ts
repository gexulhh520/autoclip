import type { AudioClipElement, EditOverlayElement, EditSession } from '../../types/editSession'
import { blockTimelineVisualStartSec } from '../../utils/editTimeline'
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
  return buildCompositionTimeline(session.sequence, transitionDurationSec(session))
}

/** 片段在时间轴上的可视起点（含入点裁剪），联动偏移相对此位置 */
export function blockLinkAnchorSec(segment: CompositionSegment): number {
  return blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
}

export function findSegmentAtCompositionTime(
  session: EditSession,
  timeSec: number
): CompositionSegment | null {
  const timeline = buildSessionCompositionTimeline(session)
  if (timeline.segments.length === 0) return null

  for (const segment of timeline.segments) {
    const anchor = blockLinkAnchorSec(segment)
    const end = anchor + segment.sourceDurationSec
    if (timeSec >= anchor - 0.001 && timeSec < end + 0.001) {
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
