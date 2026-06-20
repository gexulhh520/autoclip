import type { EditSession } from '../../types/editSession'
import type { StaggeredCharTextOptions } from './staggeredCharText'
import {
  describeSplitTextOverlayFailure,
  resolveSplitTextOverlayIds,
  splitTextContentToChars,
} from './staggeredCharText'
import { readStringParam } from '../opencut-text/params'

export interface SplitTextOverlaysBatchItem {
  source_overlay_id: string
  ok: boolean
  created_overlay_ids?: string[]
  char_count?: number
  error?: string
  skipped?: boolean
}

export interface SplitTextOverlaysBatchResult {
  items: SplitTextOverlaysBatchItem[]
  succeeded: number
  failed: number
  skipped: number
}

export function buildSplitTextOverlaysBatchResult(
  getSession: () => EditSession | null | undefined,
  overlayIds: string[],
  splitFn: (overlayId: string) => string[]
): SplitTextOverlaysBatchResult {
  const items: SplitTextOverlaysBatchItem[] = []

  for (const overlayId of overlayIds) {
    const session = getSession()
    if (!session) {
      items.push({
        source_overlay_id: overlayId,
        ok: false,
        error: '无活动剪辑工程',
      })
      continue
    }

    const element = session.overlay_elements?.find((item) => item.id === overlayId)
    if (!element) {
      items.push({
        source_overlay_id: overlayId,
        ok: false,
        error: describeSplitTextOverlayFailure(session, overlayId),
      })
      continue
    }

    const charCount = splitTextContentToChars(readStringParam(element.params, 'content', '')).length
    if (charCount <= 1) {
      items.push({
        source_overlay_id: overlayId,
        ok: true,
        skipped: true,
        char_count: charCount,
        error: charCount === 0 ? '内容为空' : '已是单字，跳过',
      })
      continue
    }

    const createdIds = splitFn(overlayId)
    if (createdIds.length === 0) {
      items.push({
        source_overlay_id: overlayId,
        ok: false,
        error: describeSplitTextOverlayFailure(session, overlayId),
      })
      continue
    }
    items.push({
      source_overlay_id: overlayId,
      ok: true,
      created_overlay_ids: createdIds,
      char_count: createdIds.length,
    })
  }

  return {
    items,
    succeeded: items.filter((item) => item.ok && !item.skipped).length,
    failed: items.filter((item) => !item.ok).length,
    skipped: items.filter((item) => item.skipped).length,
  }
}

export function resolveBatchSplitOverlayIds(
  session: EditSession,
  overlayIdsInput: unknown,
  selectedOverlayId: string | null
): string[] {
  return resolveSplitTextOverlayIds(session, overlayIdsInput, selectedOverlayId)
}

export type { StaggeredCharTextOptions }
