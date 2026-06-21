import editApi from '../../services/editApi'
import type { MatchedMoment } from '../../types/editorAgent'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import {
  formatMomentExtractReply,
} from './extractMomentsToTimeline'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export async function exportMomentsToClipPool(input: {
  projectId: string
  sessionId: string
  blockId: string
  matches: MatchedMoment[]
  searchCriteria: string
  blockTitle: string
}): Promise<{ clipIds: string[]; note: string }> {
  const response = await editApi.exportMomentClips(input.projectId, input.sessionId, {
    block_id: input.blockId,
    matches: input.matches,
  })
  useAgentPanelStore.getState().bumpClipsRefreshNonce()
  return {
    clipIds: response.clip_ids,
    note: response.note,
  }
}

export function applyMomentExtractToTimeline(
  getStore: GetEditStore,
  cached: {
    blockId: string
    blockTitle: string
    searchCriteria: string
    matches: MatchedMoment[]
  }
): { createdBlockIds: string[]; assistant_message: string } {
  const store = getStore()
  const createdBlockIds = store.extractBlocksFromMoments(cached.blockId, cached.matches)
  return {
    createdBlockIds,
    assistant_message: formatMomentExtractReply({
      blockTitle: cached.blockTitle,
      searchCriteria: cached.searchCriteria,
      createdCount: createdBlockIds.length,
      matchCount: cached.matches.length,
      createdBlockIds,
    }),
  }
}

export async function applyMomentExtractToPool(
  getStore: GetEditStore,
  input: {
    projectId: string
    sessionId: string
    blockId: string
    blockTitle: string
    searchCriteria: string
    matches: MatchedMoment[]
  }
): Promise<{ clipIds: string[]; assistant_message: string }> {
  const result = await exportMomentsToClipPool({
    projectId: input.projectId,
    sessionId: input.sessionId,
    blockId: input.blockId,
    matches: input.matches,
    searchCriteria: input.searchCriteria,
    blockTitle: input.blockTitle,
  })
  const lines = [
    `已将 ${result.clipIds.length} 段写入本草稿素材池（检索「${input.searchCriteria}」，源片段「${input.blockTitle}」）。`,
    '',
    '可在左侧「本草稿 AI 素材」预览；点 ★ 可收藏到桌面素材库，点 + 加入时间线。',
  ]
  if (result.note) {
    lines.push('')
    lines.push(result.note)
  }
  return {
    clipIds: result.clipIds,
    assistant_message: lines.join('\n').trim(),
  }
}

export function formatMomentExportChoiceHint(matchCount: number): string {
  if (matchCount <= 0) return ''
  return `找到 ${matchCount} 处匹配。默认写入本草稿 AI 素材；也可裁到时间线。`
}
