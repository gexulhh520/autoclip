import type { EditBlock, EditOverlayElement, EditSession } from '../../types/editSession'
import { OPENCUT_TEXT_DEFAULTS } from '../opencut-text/defaults'
import { normalizedToPosition } from '../opencut-text/transform'
import { resolveCanvasDimensions } from '../scene/canvas'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { compileTemplateCaptionToFreeTextLayers } from '../compositor/templateCaptionOpenCut'
import type { FreeTextLayerDef } from '../compositor/types'
import { readStringParam, type TextElementParams } from '../opencut-text/params'
import {
  DEFAULT_TEXT_TRACK_ID,
  ensureTemplateNarrationTrack,
  ensureTextTracks,
  templateNarrationTrackId,
} from '../textTracks'

export const TEMPLATE_BLOCK_ID_PARAM = 'template.blockId'

export { templateNarrationTrackId, templateNarrationTrackLabel, ensureTemplateNarrationTrack } from '../textTracks'

const resolveLayerRole = (layer: FreeTextLayerDef): string =>
  layer.role ??
  readStringParam(layer.params as TextElementParams, 'template.role', 'line')

const resolveOverlayTrackId = (
  session: EditSession,
  layer: FreeTextLayerDef,
  existing: EditOverlayElement | undefined,
  preserveUserEdits: boolean
): string => {
  const role = resolveLayerRole(layer)
  const roleTrackId = ensureTemplateNarrationTrack(session, role)
  if (!existing) return roleTrackId
  if (
    preserveUserEdits &&
    existing.track_id &&
    existing.track_id !== DEFAULT_TEXT_TRACK_ID
  ) {
    return existing.track_id
  }
  return roleTrackId
}

/** 规范化片段 overlay 字段（加载时须在旁白迁移之前执行） */
export function normalizeBlockOverlay(block: EditBlock): void {
  const raw = block.overlay as Record<string, unknown>
  const rawContent = raw.content
  const content = Array.isArray(rawContent)
    ? rawContent.map((line) => String(line))
    : typeof rawContent === 'string' && rawContent.trim()
      ? [rawContent.trim()]
      : []
  const rawOutline = raw.outline
  const outline =
    typeof rawOutline === 'string'
      ? rawOutline
      : rawOutline && typeof rawOutline === 'object'
        ? String(
            (rawOutline as Record<string, unknown>).title ??
              (rawOutline as Record<string, unknown>).outline ??
              ''
          )
        : String(rawOutline ?? content[0] ?? '')

  block.overlay = {
    ...block.overlay,
    outline,
    content,
    recommend_reason: String(raw.recommend_reason ?? ''),
    position_offset_x_pct: Number(raw.position_offset_x_pct ?? 0),
    position_offset_y_pct: Number(raw.position_offset_y_pct ?? 0),
  }
}

export const blockHasTemplateCaption = (block: EditBlock): boolean => {
  const hasOverlayText =
    block.overlay.outline.trim().length > 0 ||
    block.overlay.content.some((line) => line.trim())
  if (block.media.type === 'imported_clip') {
    return hasOverlayText
  }
  return Boolean(block.title.trim() || hasOverlayText)
}

export function getTemplateBlockId(element: EditOverlayElement): string | null {
  const fromParam = readStringParam(element.params, TEMPLATE_BLOCK_ID_PARAM, '')
  if (fromParam) return fromParam
  if (element.id.startsWith('template:')) {
    const parts = element.id.split(':')
    if (parts.length >= 3) return parts[1] ?? null
  }
  return null
}

export function isTemplateLinkedOverlay(element: EditOverlayElement): boolean {
  return Boolean(getTemplateBlockId(element))
}

export function blockHasMigratedTemplateOverlays(
  session: EditSession,
  blockId: string
): boolean {
  return getTemplateOverlaysForBlock(session, blockId).length > 0
}

export function getTemplateOverlaysForBlock(
  session: EditSession,
  blockId: string
): EditOverlayElement[] {
  return (session.overlay_elements ?? []).filter(
    (element) => getTemplateBlockId(element) === blockId
  )
}

export function getTemplateOverlayIdsForBlock(
  session: EditSession,
  blockId: string
): string[] {
  return getTemplateOverlaysForBlock(session, blockId).map((element) => element.id)
}

export function getPersistedTemplateCaptionBlockIds(session: EditSession): Set<string> {
  const ids = new Set<string>()
  for (const element of session.overlay_elements ?? []) {
    const blockId = getTemplateBlockId(element)
    if (blockId) ids.add(blockId)
  }
  return ids
}

export function removeTemplateOverlaysForBlock(
  session: EditSession,
  blockId: string
): boolean {
  if (!session.overlay_elements?.length) return false
  const before = session.overlay_elements.length
  session.overlay_elements = session.overlay_elements.filter(
    (element) => getTemplateBlockId(element) !== blockId
  )
  return session.overlay_elements.length !== before
}

export interface SyncTemplateOverlayOptions {
  /** 保留用户已调的字号、花字、位置等样式 */
  preserveUserEdits?: boolean
}

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

const findSegmentForBlock = (session: EditSession, blockId: string) => {
  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec(session))
  return timeline.segments.find((segment) => segment.block.id === blockId) ?? null
}

const layerToOverlayElement = (
  session: EditSession,
  layer: FreeTextLayerDef,
  blockId: string
): EditOverlayElement => ({
  id: layer.elementId,
  type: 'text',
  start_sec: layer.startSec,
  duration_sec: layer.durationSec,
  hidden: layer.hidden,
  track_id: resolveOverlayTrackId(session, layer, undefined, false),
  params: {
    ...layer.params,
    [TEMPLATE_BLOCK_ID_PARAM]: blockId,
    'template.role': resolveLayerRole(layer),
  },
})

const compileLayersForBlock = (
  session: EditSession,
  blockId: string
): FreeTextLayerDef[] => {
  const segment = findSegmentForBlock(session, blockId)
  if (!segment) return []
  const { width, height } = resolveCanvasDimensions(session.export_settings)
  const fromTemplate = compileTemplateCaptionToFreeTextLayers(
    segment.block,
    segment.index,
    segment.compositionStartSec,
    segment.sourceDurationSec,
    session,
    width,
    height
  )
  if (fromTemplate.length > 0) return fromTemplate
  return buildFallbackTemplateLayers(session, segment.block, segment)
}

/** 模板编译无层时，用片段标题/旁白文案生成标准自由层文本 */
const buildFallbackTemplateLayers = (
  session: EditSession,
  block: EditBlock,
  segment: {
    index: number
    compositionStartSec: number
    sourceDurationSec: number
  }
): FreeTextLayerDef[] => {
  const { width, height } = resolveCanvasDimensions(session.export_settings)
  const lines = block.overlay.content.map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    const fallback = block.overlay.outline.trim() || block.title.trim()
    if (fallback) lines.push(fallback)
  }
  if (lines.length === 0) return []

  return lines.map((text, index) => {
    const role = index === 0 ? 'headline' : `body${index}`
    const { positionX, positionY } = normalizedToPosition(
      0.5,
      0.82 - index * 0.08,
      width,
      height
    )
    return {
      kind: 'free_text' as const,
      elementId: `template:${block.id}:${role}`,
      trackId: templateNarrationTrackId(role),
      startSec: segment.compositionStartSec,
      durationSec: Math.max(segment.sourceDurationSec, 0.05),
      hidden: false,
      params: {
        ...OPENCUT_TEXT_DEFAULTS.params,
        content: text,
        'transform.positionX': positionX,
        'transform.positionY': positionY,
        'template.role': role,
      },
      source: 'user' as const,
      blockId: block.id,
      role,
      zOrder: index,
    }
  })
}

const mergeOverlayParams = (
  existing: TextElementParams,
  fresh: TextElementParams,
  blockId: string,
  preserveUserEdits: boolean
): TextElementParams => {
  if (!preserveUserEdits) {
    return { ...fresh, [TEMPLATE_BLOCK_ID_PARAM]: blockId }
  }
  return {
    ...fresh,
    ...existing,
    content: fresh.content,
    [TEMPLATE_BLOCK_ID_PARAM]: blockId,
    'template.role':
      readStringParam(existing, 'template.role', '') ||
      readStringParam(fresh, 'template.role', ''),
  }
}

/** 同步单个片段的模板旁白到 overlay_elements（创建 / 更新 / 清理） */
export function syncTemplateOverlaysForBlock(
  session: EditSession,
  blockId: string,
  options: SyncTemplateOverlayOptions = {}
): boolean {
  if (!session.overlay_elements) session.overlay_elements = []
  const preserveUserEdits = options.preserveUserEdits ?? true

  const block = session.sequence.find((item) => item.id === blockId)
  if (!block || !blockHasTemplateCaption(block)) {
    return removeTemplateOverlaysForBlock(session, blockId)
  }

  const freshLayers = compileLayersForBlock(session, blockId)
  if (freshLayers.length === 0) {
    return removeTemplateOverlaysForBlock(session, blockId)
  }

  let changed = false
  const validIds = new Set(freshLayers.map((layer) => layer.elementId))

  for (const layer of freshLayers) {
    const existing = session.overlay_elements.find((element) => element.id === layer.elementId)
    if (!existing) {
      session.overlay_elements.push(layerToOverlayElement(session, layer, blockId))
      changed = true
      continue
    }

    const fullParams = mergeOverlayParams(
      existing.params,
      layer.params,
      blockId,
      preserveUserEdits
    )
    if (JSON.stringify(existing.params) !== JSON.stringify(fullParams)) {
      existing.params = fullParams
      changed = true
    }
    if (
      existing.start_sec !== layer.startSec ||
      existing.duration_sec !== layer.durationSec
    ) {
      existing.start_sec = layer.startSec
      existing.duration_sec = layer.durationSec
      changed = true
    }
    const nextTrackId = resolveOverlayTrackId(session, layer, existing, preserveUserEdits)
    if (existing.track_id !== nextTrackId) {
      existing.track_id = nextTrackId
      changed = true
    }
  }

  const filtered = session.overlay_elements.filter(
    (element) => getTemplateBlockId(element) !== blockId || validIds.has(element.id)
  )
  if (filtered.length !== session.overlay_elements.length) {
    session.overlay_elements = filtered
    changed = true
  }

  return changed
}

/** 将自由层文本改动回写片段 overlay（供 AI / 导出元数据） */
export function syncBlockOverlayFromTemplateOverlays(
  session: EditSession,
  blockId: string
): boolean {
  const block = session.sequence.find((item) => item.id === blockId)
  if (!block) return false
  const overlays = getTemplateOverlaysForBlock(session, blockId)
  if (overlays.length === 0) return false

  const sorted = [...overlays].sort((a, b) => {
    const roleA = readStringParam(a.params, 'template.role', 'z')
    const roleB = readStringParam(b.params, 'template.role', 'z')
    if (roleA === 'headline') return -1
    if (roleB === 'headline') return 1
    return roleA.localeCompare(roleB)
  })

  const content = sorted
    .map((element) => readStringParam(element.params, 'content', '').trim())
    .filter(Boolean)
  if (content.length === 0) return false

  const nextOutline = content[0] ?? ''
  const sameOutline = block.overlay.outline === nextOutline
  const sameContent =
    block.overlay.content.length === content.length &&
    block.overlay.content.every((line, index) => line === content[index])
  if (sameOutline && sameContent) return false

  block.overlay = {
    ...block.overlay,
    outline: nextOutline,
    content,
  }
  return true
}

/** 加载 / 重排 / 裁剪后，确保所有模板旁白以自由层文本形式存在且时间对齐 */
export function ensureTemplateCaptionOverlays(session: EditSession): boolean {
  if (!session.overlay_elements) session.overlay_elements = []
  ensureTextTracks(session)

  let changed = false
  const blockIdsWithCaption = new Set<string>()

  for (const block of session.sequence) {
    if (blockHasTemplateCaption(block)) {
      blockIdsWithCaption.add(block.id)
      if (syncTemplateOverlaysForBlock(session, block.id)) {
        changed = true
      }
    } else if (removeTemplateOverlaysForBlock(session, block.id)) {
      changed = true
    }
  }

  const orphans = (session.overlay_elements ?? []).filter((element) => {
    const blockId = getTemplateBlockId(element)
    return blockId && !blockIdsWithCaption.has(blockId)
  })
  if (orphans.length > 0) {
    session.overlay_elements = session.overlay_elements!.filter(
      (element) => !orphans.includes(element)
    )
    changed = true
  }

  return changed
}

/** @deprecated 使用 ensureTemplateCaptionOverlays */
export function migrateTemplateCaptionsToOverlayElements(session: EditSession): boolean {
  return ensureTemplateCaptionOverlays(session)
}
