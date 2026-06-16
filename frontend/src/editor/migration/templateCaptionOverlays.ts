import type { EditBlock, EditOverlayElement, EditSession } from '../../types/editSession'
import { resolveCanvasDimensions } from '../scene/canvas'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import {
  compileTemplateCaptionToFreeTextLayers,
} from '../compositor/templateCaptionOpenCut'
import type { FreeTextLayerDef } from '../compositor/types'
import { readNumberParam, readStringParam, type TextElementParams } from '../opencut-text/params'
import { DEFAULT_TEXT_TRACK_ID, ensureTextTracks } from '../textTracks'

export const TEMPLATE_BLOCK_ID_PARAM = 'template.blockId'

export const blockHasTemplateCaption = (block: EditBlock): boolean =>
  Boolean(
    block.title.trim() ||
      block.overlay.outline.trim() ||
      block.overlay.content.some((line) => line.trim())
  )

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
  /** 保留用户在预览区拖拽后的位置 */
  preservePosition?: boolean
}

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

const findSegmentForBlock = (session: EditSession, blockId: string) => {
  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec(session))
  return timeline.segments.find((segment) => segment.block.id === blockId) ?? null
}

const mergePreservingPosition = (
  existing: TextElementParams,
  fresh: TextElementParams
): TextElementParams => ({
  ...fresh,
  'transform.positionX': readNumberParam(
    existing,
    'transform.positionX',
    readNumberParam(fresh, 'transform.positionX', 0)
  ),
  'transform.positionY': readNumberParam(
    existing,
    'transform.positionY',
    readNumberParam(fresh, 'transform.positionY', 0)
  ),
})

const layerToOverlayElement = (
  layer: FreeTextLayerDef,
  blockId: string
): EditOverlayElement => ({
  id: layer.elementId,
  type: 'text',
  start_sec: layer.startSec,
  duration_sec: layer.durationSec,
  hidden: layer.hidden,
  track_id: DEFAULT_TEXT_TRACK_ID,
  params: {
    ...layer.params,
    [TEMPLATE_BLOCK_ID_PARAM]: blockId,
  },
})

const compileLayersForBlock = (
  session: EditSession,
  blockId: string
): FreeTextLayerDef[] => {
  const segment = findSegmentForBlock(session, blockId)
  if (!segment) return []
  const { width, height } = resolveCanvasDimensions(session.export_settings)
  return compileTemplateCaptionToFreeTextLayers(
    segment.block,
    segment.index,
    segment.compositionStartSec,
    segment.sourceDurationSec,
    session,
    width,
    height
  )
}

/** 同步单个片段的模板旁白到 overlay_elements（创建 / 更新 / 清理） */
export function syncTemplateOverlaysForBlock(
  session: EditSession,
  blockId: string,
  options: SyncTemplateOverlayOptions = {}
): boolean {
  if (!session.overlay_elements) session.overlay_elements = []
  const preservePosition = options.preservePosition ?? true

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
      session.overlay_elements.push(layerToOverlayElement(layer, blockId))
      changed = true
      continue
    }

    const nextParams = preservePosition
      ? mergePreservingPosition(existing.params, layer.params)
      : layer.params
    const fullParams: TextElementParams = {
      ...nextParams,
      [TEMPLATE_BLOCK_ID_PARAM]: blockId,
    }
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
    if (existing.track_id !== DEFAULT_TEXT_TRACK_ID) {
      existing.track_id = DEFAULT_TEXT_TRACK_ID
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
