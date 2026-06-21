import { buildEditorSnapshot } from './buildEditorSnapshot'
import {
  executeApplyCaptionTemplate,
  migrateAddCaptionsArgs,
  type ApplyCaptionTemplateResult,
} from './applyCaptionTemplate'
import { pickBlockDraftCaption } from './pickBlockDraftCaption'
import { readStringParam } from '../opencut-text/params'
import { DEFAULT_VIDEO_TRACK_ID } from '../videoTracks'
import type { EditSession } from '../../types/editSession'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export interface BlockCaptionItem {
  block_id: string
  content: string
}

export interface AddCaptionsForBlocksArguments {
  content?: string
  block_captions?: BlockCaptionItem[]
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

export type AddCaptionsForBlocksResult = ApplyCaptionTemplateResult & { content: string }

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

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** @deprecated 内部兼容；Agent 请用 apply_caption_template */
export function executeAddCaptionsForBlocks(
  getStore: GetEditStore,
  args: AddCaptionsForBlocksArguments,
  options?: { recordHistory?: boolean }
): AddCaptionsForBlocksResult {
  const store = getStore()
  const session = store.session

  if (Array.isArray(args.block_captions) && args.block_captions.length > 0) {
    const result = executeApplyCaptionTemplate(
      getStore,
      migrateAddCaptionsArgs(args as unknown as Record<string, unknown>),
      options
    )
    return { ...result, content: '(block_captions)' }
  }

  if (session && args.use_block_draft) {
    const snapshot = buildEditorSnapshot({
      session,
      playheadSec: store.sequencePlayheadSec,
      selectedBlockId: store.selectedBlockId,
      selectedOverlayId: store.selectedOverlayId,
    })
    const entries = snapshot.blocks
      .filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
      .map((block) => ({
        block_id: block.id,
        text: pickBlockDraftCaption(session, block.id),
      }))
      .filter((item) => item.text.trim())
    const result = executeApplyCaptionTemplate(
      getStore,
      {
        layout: args.layout === 'vertical' ? 'vertical' : 'horizontal',
        position: 'bottom_center',
        entries,
        style: {
          fontFamily: args.fontFamily,
          color: args.color,
          fontWeight: args.fontWeight,
        },
        animation: {
          in_type: args.in_type,
          in_duration_sec: args.in_duration_sec,
          stagger_sec: args.stagger_sec,
        },
        skip_existing: args.skip_existing,
      },
      options
    )
    return { ...result, content: '(per-block draft)' }
  }

  const uniform = str(args.content).trim()
  if (session && uniform) {
    const snapshot = buildEditorSnapshot({
      session,
      playheadSec: store.sequencePlayheadSec,
      selectedBlockId: store.selectedBlockId,
      selectedOverlayId: store.selectedOverlayId,
    })
    const idFilter = Array.isArray(args.block_ids)
      ? new Set(args.block_ids.map((id) => String(id).trim()).filter(Boolean))
      : null
    const entries = snapshot.blocks
      .filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
      .filter((block) => !idFilter || idFilter.has(block.id))
      .map((block) => ({ block_id: block.id, text: uniform }))
    const result = executeApplyCaptionTemplate(
      getStore,
      {
        layout: args.layout === 'vertical' ? 'vertical' : 'horizontal',
        position: 'bottom_center',
        entries,
        style: {
          fontFamily: args.fontFamily,
          color: args.color,
          fontWeight: args.fontWeight,
        },
        animation: {
          in_type: args.in_type,
          in_duration_sec: args.in_duration_sec,
          stagger_sec: args.stagger_sec,
        },
        skip_existing: args.skip_existing,
      },
      options
    )
    return { ...result, content: uniform }
  }

  const result = executeApplyCaptionTemplate(getStore, migrateAddCaptionsArgs(args as unknown as Record<string, unknown>), options)
  return { ...result, content: '' }
}
