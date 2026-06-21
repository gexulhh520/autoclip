import { buildEditorSnapshot } from './buildEditorSnapshot'
import { listOverlaysForBlock } from './blockCaptionUtils'
import { getTemplateOverlayIdsForBlock } from '../migration/templateCaptionOverlays'
import { DEFAULT_VIDEO_TRACK_ID } from '../videoTracks'
import type { EditSession } from '../../types/editSession'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export interface ClearBlockCaptionsItem {
  block_id: string
  overlays_removed: number
  cleared_draft: boolean
  error?: string
}

export interface ClearCaptionsResult {
  blocks_targeted: number
  overlays_removed: number
  items: ClearBlockCaptionsItem[]
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function collectCaptionOverlayIds(
  session: EditSession,
  blockId: string,
  blockStartSec: number,
  blockEndSec: number
): string[] {
  const ids = new Set<string>()
  for (const overlay of listOverlaysForBlock(session, blockId, blockStartSec, blockEndSec)) {
    ids.add(overlay.id)
  }
  for (const id of getTemplateOverlayIdsForBlock(session, blockId)) {
    ids.add(id)
  }
  return [...ids]
}

function clearBlockOverlayDraft(session: EditSession, blockId: string): boolean {
  const block = session.sequence?.find((item) => item.id === blockId)
  if (!block) return false
  const hadContent =
    (block.overlay?.content?.length ?? 0) > 0 ||
    Boolean(block.overlay?.outline?.trim()) ||
    Boolean(block.overlay?.recommend_reason?.trim())
  block.overlay = {
    ...block.overlay,
    content: [],
    outline: '',
    recommend_reason: block.overlay?.recommend_reason ?? '',
    caption_suppressed: true,
  }
  return hadContent
}

function resolveMainTrackBlocks(getStore: GetEditStore) {
  const store = getStore()
  const session = store.session
  if (!session) return { session: null, blocks: [] as Array<{ id: string; start: number; end: number }> }

  const snapshot = buildEditorSnapshot({
    session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
  })

  const blocks = snapshot.blocks
    .filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
    .filter((block) => block.timeline_start_sec != null && block.timeline_end_sec != null)
    .map((block) => ({
      id: block.id,
      start: block.timeline_start_sec!,
      end: block.timeline_end_sec!,
    }))

  return { session, blocks }
}

function executeClearForBlocks(
  getStore: GetEditStore,
  blockIds: string[],
  options?: { recordHistory?: boolean }
): ClearCaptionsResult {
  const { session, blocks } = resolveMainTrackBlocks(getStore)
  const blockById = new Map(blocks.map((block) => [block.id, block]))
  const items: ClearBlockCaptionsItem[] = []
  let overlaysRemoved = 0

  if (!session) {
    return {
      blocks_targeted: blockIds.length,
      overlays_removed: 0,
      items: blockIds.map((blockId) => ({
        block_id: blockId,
        overlays_removed: 0,
        cleared_draft: false,
        error: '无活动剪辑工程',
      })),
    }
  }

  const removeIds: string[] = []

  for (const rawId of blockIds) {
    const blockId = str(rawId).trim()
    if (!blockId) continue
    const target = blockById.get(blockId)
    if (!target) {
      items.push({
        block_id: blockId,
        overlays_removed: 0,
        cleared_draft: false,
        error: '片段不存在或非主轨',
      })
      continue
    }

    const ids = collectCaptionOverlayIds(session, blockId, target.start, target.end)
    removeIds.push(...ids)
    items.push({
      block_id: blockId,
      overlays_removed: ids.length,
      cleared_draft: false,
    })
  }

  if (removeIds.length > 0) {
    getStore().removeOverlayElements([...new Set(removeIds)])
    overlaysRemoved = new Set(removeIds).size
  }

  const sessionAfter = getStore().session
  if (sessionAfter) {
    for (const item of items) {
      if (item.error) continue
      const cleared = clearBlockOverlayDraft(sessionAfter, item.block_id)
      item.cleared_draft = cleared
    }
  }

  return {
    blocks_targeted: blockIds.length,
    overlays_removed: overlaysRemoved,
    items,
  }
}

export function executeClearBlockCaptions(
  getStore: GetEditStore,
  blockIdsInput: unknown,
  options?: { recordHistory?: boolean }
): ClearCaptionsResult {
  const blockIds = Array.isArray(blockIdsInput)
    ? blockIdsInput.map((id) => str(id).trim()).filter(Boolean)
    : []
  if (blockIds.length === 0) {
    return {
      blocks_targeted: 0,
      overlays_removed: 0,
      items: [
        {
          block_id: '',
          overlays_removed: 0,
          cleared_draft: false,
          error: 'block_ids 不能为空',
        },
      ],
    }
  }
  return executeClearForBlocks(getStore, blockIds, options)
}

export function executeClearAllCaptions(
  getStore: GetEditStore,
  options?: { recordHistory?: boolean }
): ClearCaptionsResult {
  const { blocks } = resolveMainTrackBlocks(getStore)
  if (blocks.length === 0) {
    return {
      blocks_targeted: 0,
      overlays_removed: 0,
      items: [{ block_id: '', overlays_removed: 0, cleared_draft: false, error: '主轨无视频片段' }],
    }
  }
  return executeClearForBlocks(
    getStore,
    blocks.map((block) => block.id),
    options
  )
}
