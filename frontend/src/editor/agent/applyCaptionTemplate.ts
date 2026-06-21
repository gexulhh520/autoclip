import { buildEditorSnapshot } from './buildEditorSnapshot'
import {
  blockAlreadyHasCaptionText,
  collectCaptionTextFromOverlays,
  listOverlaysForBlock,
  resolveBlockCaptionTiming,
} from './blockCaptionUtils'
import { resolveCaptionPlacement, resolveLayoutAndPosition } from './captionTemplateLayout'
import { mapFontFamily } from './fontMapping'
import { mergeDefaultTextAnimation } from './defaultAnimation'
import { resolveCanvasDimensions } from '../scene/canvas'
import { DEFAULT_VIDEO_TRACK_ID } from '../videoTracks'
import { validateMotionType } from './packagingTools'
import { writeOverlayBlockLink } from '../timeline/timelineBlockLink'
import type { EditSession } from '../../types/editSession'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export interface CaptionTemplateEntry {
  block_id: string
  /** LLM 首选字段 */
  text?: string
  /** 兼容旧 block_captions.content */
  content?: string
}

export interface CaptionTemplateStyle {
  fontFamily?: string
  color?: string
  fontWeight?: string
}

export interface CaptionTemplateAnimation {
  in_type?: unknown
  in_duration_sec?: number
  stagger_sec?: number
}

export interface ApplyCaptionTemplateArguments {
  /** @deprecated 用 layout + position */
  template?: unknown
  layout?: unknown
  position?: unknown
  entries: CaptionTemplateEntry[]
  style?: CaptionTemplateStyle
  animation?: CaptionTemplateAnimation
  skip_existing?: boolean
  /** 改布局时 true：先删该片段现有字幕再重建（横↔竖） */
  replace_existing?: boolean
}

export interface ApplyCaptionTemplateItem {
  block_id: string
  timeline_start_sec: number
  text: string
  layout: string
  position: string
  overlay_id?: string
  skipped?: boolean
  split_char_count?: number
  error?: string
}

export interface ApplyCaptionTemplateResult {
  layout: string
  position: string
  /** @deprecated */
  template?: string
  blocks_targeted: number
  overlays_added: number
  overlays_skipped: number
  overlays_removed: number
  split_char_layers: number
  items: ApplyCaptionTemplateItem[]
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function parseEntries(raw: unknown, allowMissingText = false): CaptionTemplateEntry[] {
  if (!Array.isArray(raw)) return []
  const out: CaptionTemplateEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const blockId = str(record.block_id).trim()
    const text = str(record.text || record.content).trim()
    if (blockId && (text || allowMissingText)) out.push({ block_id: blockId, text })
  }
  return out
}

function buildOverlayParams(input: {
  text: string
  placement: ReturnType<typeof resolveCaptionPlacement>
  style: CaptionTemplateStyle
  animation: CaptionTemplateAnimation
}): Record<string, string | number | boolean> {
  const inType = validateMotionType(input.animation.in_type)
  const params: Record<string, string | number | boolean> = {
    content: input.text,
    fontSize: input.placement.fontSize,
    fontFamily: mapFontFamily(str(input.style.fontFamily)),
    color: str(input.style.color, '#ffffff'),
    fontWeight: str(input.style.fontWeight, 'normal'),
    textAlign: input.placement.textAlign,
    lineHeight: 1.2,
    'transform.positionX': input.placement.positionX,
    'transform.positionY': input.placement.positionY,
    'transform.scaleX': 1,
    'transform.scaleY': 1,
    'transform.rotate': 0,
  }
  if (inType) {
    params['animation.in.type'] = inType
    params['animation.in.duration'] = num(input.animation.in_duration_sec, 0.35)
  }
  return mergeDefaultTextAnimation(params)
}

function bindOverlayToBlock(
  getStore: GetEditStore,
  overlayId: string,
  blockId: string,
  startSec: number,
  durationSec: number
): void {
  const store = getStore()
  const session = store.session
  if (!session?.overlay_elements) return
  const element = session.overlay_elements.find((item) => item.id === overlayId)
  if (!element) return
  element.start_sec = startSec
  element.duration_sec = durationSec
  const timing = resolveBlockCaptionTiming(session, blockId)
  const offsetSec = timing ? Math.max(0, startSec - timing.startSec) : 0
  writeOverlayBlockLink(element, blockId, offsetSec)
}

export function executeApplyCaptionTemplate(
  getStore: GetEditStore,
  args: ApplyCaptionTemplateArguments,
  options?: { recordHistory?: boolean }
): ApplyCaptionTemplateResult {
  const store = getStore()
  const session = store.session
  const layoutPosition = resolveLayoutAndPosition({
    layout: args.layout,
    position: args.position,
    template: args.template,
  })
  const style = args.style ?? {}
  const animation = args.animation ?? {}
  const replaceExisting = args.replace_existing === true
  let entries = parseEntries(args.entries, replaceExisting)

  if (!session) {
    return {
      layout: layoutPosition.layout,
      position: layoutPosition.position,
      blocks_targeted: 0,
      overlays_added: 0,
      overlays_skipped: 0,
      overlays_removed: 0,
      split_char_layers: 0,
      items: [{ block_id: '', timeline_start_sec: 0, text: '', layout: '', position: '', error: '无活动剪辑工程' }],
    }
  }

  if (entries.length === 0) {
    return {
      layout: layoutPosition.layout,
      position: layoutPosition.position,
      blocks_targeted: 0,
      overlays_added: 0,
      overlays_skipped: 0,
      overlays_removed: 0,
      split_char_layers: 0,
      items: [
        {
          block_id: '',
          timeline_start_sec: 0,
          text: '',
          layout: '',
          position: '',
          error: 'entries 不能为空，每项须含 block_id 与 text',
        },
      ],
    }
  }

  const snapshot = buildEditorSnapshot({
    session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
  })

  const blockById = new Map(
    snapshot.blocks
      .filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
      .filter((block) => block.timeline_start_sec != null && block.timeline_end_sec != null)
      .map((block) => [
        block.id,
        {
          timeline_start_sec: block.timeline_start_sec!,
          timeline_end_sec: block.timeline_end_sec!,
          duration_sec: block.duration_sec,
        },
      ])
  )

  if (replaceExisting && entries.length === 0) {
    entries = [...blockById.keys()].map((blockId) => ({ block_id: blockId, text: '' }))
  }

  const dims = resolveCanvasDimensions(session.export_settings, store.previewVideoNaturalSize ?? null)
  const skipExisting = args.skip_existing !== false && !replaceExisting
  const items: ApplyCaptionTemplateItem[] = []
  let overlaysAdded = 0
  let overlaysSkipped = 0
  let overlaysRemoved = 0
  let splitCharLayers = 0

  for (const entry of entries) {
    let text = str(entry.text || entry.content).trim()
    const target = blockById.get(entry.block_id)
    if (!target) {
      items.push({
        block_id: entry.block_id,
        timeline_start_sec: 0,
        text,
        layout: layoutPosition.layout,
        position: layoutPosition.position,
        error: `片段不存在或非主轨: ${entry.block_id}`,
      })
      continue
    }

    const existingOverlays = listOverlaysForBlock(
      getStore().session ?? session,
      entry.block_id,
      target.timeline_start_sec,
      target.timeline_end_sec
    )

    if (replaceExisting && existingOverlays.length > 0) {
      if (!text) {
        text = collectCaptionTextFromOverlays(
          existingOverlays,
          dims.width,
          dims.height
        ).trim()
      }
      const removeIds = existingOverlays.map((el) => el.id)
      store.removeOverlayElements(removeIds)
      overlaysRemoved += removeIds.length
    }

    if (!text) {
      items.push({
        block_id: entry.block_id,
        timeline_start_sec: target.timeline_start_sec,
        text: '',
        layout: layoutPosition.layout,
        position: layoutPosition.position,
        error: replaceExisting
          ? '该片段无可用字幕文案，请提供 text'
          : 'entries 每项须含 block_id 与 text',
      })
      continue
    }

    const placement = resolveCaptionPlacement({
      layout: args.layout,
      position: args.position,
      template: args.template,
      text,
      canvasWidth: dims.width,
      canvasHeight: dims.height,
    })

    if (skipExisting && blockAlreadyHasCaptionText(
      getStore().session!,
      entry.block_id,
      target.timeline_start_sec,
      target.timeline_end_sec,
      text,
      dims.width,
      dims.height
    )) {
      overlaysSkipped += 1
      items.push({
        block_id: entry.block_id,
        timeline_start_sec: target.timeline_start_sec,
        text,
        layout: placement.layout,
        position: placement.position,
        skipped: true,
      })
      continue
    }

    const blockTiming =
      resolveBlockCaptionTiming(getStore().session ?? session, entry.block_id) ?? {
        startSec: target.timeline_start_sec,
        durationSec: target.timeline_end_sec - target.timeline_start_sec,
      }

    const params = buildOverlayParams({ text, placement, style, animation })
    store.addOverlayElement(
      {
        type: 'text',
        hidden: false,
        start_sec: blockTiming.startSec,
        duration_sec: blockTiming.durationSec,
        params,
      },
      { recordHistory: false, skipTimingClamp: true }
    )

    const overlayId = getStore().selectedOverlayId
    if (!overlayId) {
      items.push({
        block_id: entry.block_id,
        timeline_start_sec: target.timeline_start_sec,
        text,
        layout: placement.layout,
        position: placement.position,
        error: '添加文本层失败',
      })
      continue
    }

    bindOverlayToBlock(
      getStore,
      overlayId,
      entry.block_id,
      blockTiming.startSec,
      blockTiming.durationSec
    )

    overlaysAdded += 1
    let splitCharCount = 0

    if (placement.splitChars) {
      const createdIds = store.splitTextOverlayByChar(
        overlayId,
        {
          layout: 'vertical',
          in_type: animation.in_type,
          in_duration_sec: animation.in_duration_sec,
          stagger_sec: animation.stagger_sec,
          center_x: placement.normalizedCenter.x,
          center_y: placement.normalizedCenter.y,
        },
        { recordHistory: false, skipTimingClamp: true }
      )
      splitCharCount = createdIds.length
      splitCharLayers += splitCharCount
      const sessionAfterSplit = getStore().session
      if (sessionAfterSplit) {
        for (const charId of createdIds) {
          const charEl = sessionAfterSplit.overlay_elements?.find((item) => item.id === charId)
          if (!charEl) continue
          const offsetSec = Math.max(0, charEl.start_sec - blockTiming.startSec)
          writeOverlayBlockLink(charEl, entry.block_id, offsetSec)
        }
      }
    }

    items.push({
      block_id: entry.block_id,
      timeline_start_sec: target.timeline_start_sec,
      text,
      layout: placement.layout,
      position: placement.position,
      overlay_id: overlayId,
      split_char_count: splitCharCount > 0 ? splitCharCount : undefined,
    })
  }

  return {
    layout: layoutPosition.layout,
    position: layoutPosition.position,
    blocks_targeted: entries.length,
    overlays_added: overlaysAdded,
    overlays_skipped: overlaysSkipped,
    overlays_removed: overlaysRemoved,
    split_char_layers: splitCharLayers,
    items,
  }
}

/** 旧 add_captions_for_blocks 参数 → apply_caption_template */
export function migrateAddCaptionsArgs(raw: Record<string, unknown>): ApplyCaptionTemplateArguments {
  const blockCaptions = raw.block_captions
  const entries: CaptionTemplateEntry[] = []
  if (Array.isArray(blockCaptions)) {
    for (const item of blockCaptions) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      entries.push({
        block_id: str(record.block_id),
        content: str(record.content),
      })
    }
  }

  const layout = str(raw.layout)
  return {
    layout: layout === 'vertical' ? 'vertical' : undefined,
    position: undefined,
    template: layout === 'vertical' ? 'vertical_stagger' : raw.template ?? 'bottom_safe',
    entries,
    style: {
      fontFamily: str(raw.fontFamily) || undefined,
      color: str(raw.color) || undefined,
      fontWeight: str(raw.fontWeight) || undefined,
    },
    animation: {
      in_type: raw.in_type,
      in_duration_sec: raw.in_duration_sec as number | undefined,
      stagger_sec: raw.stagger_sec as number | undefined,
    },
    skip_existing: raw.skip_existing as boolean | undefined,
    replace_existing: raw.replace_existing as boolean | undefined,
  }
}
