import { buildEditorSnapshot } from './buildEditorSnapshot'
import { mapFontFamily } from './fontMapping'
import { mergeDefaultTextAnimation } from './defaultAnimation'
import { pickBlockDraftCaption } from './pickBlockDraftCaption'
import { resolveBatchSplitPlacement } from './staggeredCharText'
import { resolveCanvasDimensions } from '../scene/canvas'
import { readStringParam } from '../opencut-text/params'
import { DEFAULT_VIDEO_TRACK_ID } from '../videoTracks'
import { validateMotionType } from './packagingTools'
import type { EditSession } from '../../types/editSession'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export interface AddCaptionsForBlocksArguments {
  content?: string
  /** 为 true 时按片段 outline/content/title 取文案，忽略统一 content */
  use_block_draft?: boolean
  block_ids?: string[]
  skip_existing?: boolean
  layout?: 'horizontal' | 'vertical'
  fontSize?: number
  fontFamily?: string
  color?: string
  fontWeight?: string
  in_type?: unknown
  in_duration_sec?: number
  stagger_sec?: number
}

export interface AddCaptionsForBlocksItem {
  block_id: string
  timeline_start_sec: number
  overlay_id?: string
  skipped?: boolean
  split_char_count?: number
  error?: string
}

export interface AddCaptionsForBlocksResult {
  content: string
  blocks_targeted: number
  overlays_added: number
  overlays_skipped: number
  split_char_layers: number
  items: AddCaptionsForBlocksItem[]
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function buildCaptionParams(
  args: AddCaptionsForBlocksArguments
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    content: str(args.content, '文本'),
    fontSize: num(args.fontSize, 6),
    fontFamily: mapFontFamily(str(args.fontFamily)),
    color: str(args.color, '#ffffff'),
    fontWeight: str(args.fontWeight, 'normal'),
    textAlign: 'center',
    lineHeight: 1.2,
    'transform.positionX': 0,
    'transform.positionY': 0,
    'transform.scaleX': 1,
    'transform.scaleY': 1,
    'transform.rotate': 0,
  }
  const inType = validateMotionType(args.in_type)
  if (inType) {
    params['animation.in.type'] = inType
    params['animation.in.duration'] = num(args.in_duration_sec, 0.35)
  }
  return mergeDefaultTextAnimation(params)
}

export function blockAlreadyHasCaption(
  session: EditSession,
  blockStart: number,
  content: string
): boolean {
  const normalized = content.replace(/\s+/g, '')
  if (!normalized) return false
  for (const el of session.overlay_elements ?? []) {
    if (el.type !== 'text' || el.hidden) continue
    if (Math.abs(el.start_sec - blockStart) > 0.25) continue
    const text = readStringParam(el.params, 'content', '').replace(/\s+/g, '')
    if (!text) continue
    if (text === normalized) return true
    if (text.length >= 2 && normalized.includes(text)) return true
    if (text.length >= 2 && text.includes(normalized)) return true
  }
  return false
}

export function executeAddCaptionsForBlocks(
  getStore: GetEditStore,
  args: AddCaptionsForBlocksArguments,
  options?: { recordHistory?: boolean }
): AddCaptionsForBlocksResult {
  const store = getStore()
  const session = store.session
  if (!session) {
    return {
      content: str(args.content),
      blocks_targeted: 0,
      overlays_added: 0,
      overlays_skipped: 0,
      split_char_layers: 0,
      items: [{ block_id: '', timeline_start_sec: 0, error: '无活动剪辑工程' }],
    }
  }

  const useBlockDraft = args.use_block_draft === true
  const uniformContent = str(args.content).trim()

  if (!useBlockDraft && !uniformContent) {
    return {
      content: '',
      blocks_targeted: 0,
      overlays_added: 0,
      overlays_skipped: 0,
      split_char_layers: 0,
      items: [{ block_id: '', timeline_start_sec: 0, error: 'content 不能为空（或设 use_block_draft=true）' }],
    }
  }

  const snapshot = buildEditorSnapshot({
    session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
  })

  const idFilter = Array.isArray(args.block_ids)
    ? new Set(args.block_ids.map((id) => String(id).trim()).filter(Boolean))
    : null

  const targets = snapshot.blocks
    .filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
    .filter((block) => block.timeline_start_sec != null)
    .filter((block) => !idFilter || idFilter.has(block.id))
    .map((block) => ({
      block_id: block.id,
      timeline_start_sec: block.timeline_start_sec!,
      duration_sec: block.duration_sec,
    }))

  const skipExisting = args.skip_existing !== false
  const layout = args.layout === 'vertical' ? 'vertical' : 'horizontal'
  const items: AddCaptionsForBlocksItem[] = []
  let overlaysAdded = 0
  let overlaysSkipped = 0
  let splitCharLayers = 0

  const dims = resolveCanvasDimensions(session.export_settings, store.previewVideoNaturalSize ?? null)

  if (options?.recordHistory !== false && targets.length > 0) {
    // history pushed by executeAgentToolCalls batch wrapper
  }

  for (const target of targets) {
    const blockContent = useBlockDraft
      ? pickBlockDraftCaption(session, target.block_id)
      : uniformContent
    if (!blockContent.trim()) {
      items.push({
        block_id: target.block_id,
        timeline_start_sec: target.timeline_start_sec,
        error: '片段无可用草稿文案',
      })
      continue
    }

    const splitAfterAdd =
      layout === 'vertical' && blockContent.replace(/\s+/g, '').length >= 2

    if (skipExisting && blockAlreadyHasCaption(session, target.timeline_start_sec, blockContent)) {
      overlaysSkipped += 1
      items.push({
        block_id: target.block_id,
        timeline_start_sec: target.timeline_start_sec,
        skipped: true,
      })
      continue
    }

    const params = buildCaptionParams({ ...args, content: blockContent })
    store.addOverlayElement(
      {
        type: 'text',
        hidden: false,
        start_sec: target.timeline_start_sec,
        duration_sec: target.duration_sec,
        params,
      },
      { recordHistory: false }
    )

    const overlayId = getStore().selectedOverlayId
    if (!overlayId) {
      items.push({
        block_id: target.block_id,
        timeline_start_sec: target.timeline_start_sec,
        error: '添加文本层失败',
      })
      continue
    }

    overlaysAdded += 1
    let splitCharCount = 0

    if (splitAfterAdd) {
      const placement = resolveBatchSplitPlacement(
        getStore().session!,
        [overlayId],
        dims.width,
        dims.height
      )
      const place = placement.get(overlayId)
      const createdIds = store.splitTextOverlayByChar(
        overlayId,
        {
          layout: 'vertical',
          in_type: args.in_type,
          in_duration_sec: args.in_duration_sec,
          stagger_sec: args.stagger_sec,
          center_x: place?.center_x,
          center_y: place?.center_y,
        },
        { recordHistory: false }
      )
      splitCharCount = createdIds.length
      splitCharLayers += splitCharCount
    }

    items.push({
      block_id: target.block_id,
      timeline_start_sec: target.timeline_start_sec,
      overlay_id: overlayId,
      split_char_count: splitCharCount > 0 ? splitCharCount : undefined,
    })
  }

  return {
    content: useBlockDraft ? '(per-block draft)' : uniformContent,
    blocks_targeted: targets.length,
    overlays_added: overlaysAdded,
    overlays_skipped: overlaysSkipped,
    split_char_layers: splitCharLayers,
    items,
  }
}
