import {
  resolveAnalyzeBlockId,
  resolveBlockTimelineWindow,
} from './analyzeBlockContentUtils'
import {
  resolveMomentSearchFrameSampleCount,
  resolveMomentSearchSampleTimesSec,
} from './momentSearchFrameUtils'
import {
  formatMomentRecallModeHint,
  resolveMomentRecallMode,
} from './momentRecallMode'
import { editorAgentApi } from '../../services/editorAgentApi'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { MatchedMoment } from '../../types/editorAgent'
import type { FindBlockMomentsRequest } from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

export interface FindBlockMomentsResult {
  block_id: string
  block_title: string
  search_criteria: string
  duration_sec: number
  timeline_start_sec: number
  timeline_end_sec: number
  transcript_source: string
  transcript_segment_count: number
  visual_frame_count: number
  matches: MatchedMoment[]
  note: string
}

/** 按用户描述检索片段：转写文本 + 画面抽帧双路径（抽帧由后端 ffmpeg 完成） */
export async function findBlockMoments(input: {
  projectId: string
  sessionId: string
  session: EditSession
  args: Record<string, unknown>
  selectedBlockId: string | null
}): Promise<FindBlockMomentsResult> {
  const focusedBlockId = useAgentPanelStore.getState().getFocusedBlockId(input.sessionId)
  const blockId = resolveAnalyzeBlockId({
    args: input.args,
    focusedBlockId,
    selectedBlockId: input.selectedBlockId,
  })
  if (!blockId) {
    throw new Error('请指定 block_id，或先在时间线选中/添加到 AI 助手的片段')
  }

  const block = input.session.sequence?.find((item) => item.id === blockId)
  if (!block) {
    throw new Error(`片段不存在: ${blockId}`)
  }

  const searchCriteria = String(
    input.args.search_criteria ?? input.args.user_question ?? ''
  ).trim()
  if (!searchCriteria) {
    throw new Error('请提供 search_criteria（检索条件），如「打斗场面」「富有哲学的话」')
  }

  const timelineWindow = resolveBlockTimelineWindow(input.session, blockId)
  if (!timelineWindow) {
    throw new Error(`无法解析片段时间范围: ${blockId}`)
  }

  const explicitSampleCount = Number(input.args.frame_sample_count)
  const sampleCount =
    Number.isFinite(explicitSampleCount) && explicitSampleCount > 0
      ? explicitSampleCount
      : resolveMomentSearchFrameSampleCount(timelineWindow.duration_sec)
  const sampleTimes = resolveMomentSearchSampleTimesSec(timelineWindow, sampleCount)

  const includeVisual = input.args.include_visual !== false
  const recallMode =
    input.args.recall_mode === 'high' || input.args.recall_mode === 'balanced'
      ? input.args.recall_mode
      : resolveMomentRecallMode({
          sessionId: input.sessionId,
          session: input.session,
          blockId,
          args: input.args,
          searchCriteria,
        })

  const maxResults = Number.isFinite(Number(input.args.max_results))
    ? Number(input.args.max_results)
    : recallMode === 'high'
      ? 24
      : 12

  const visualProfile = String(input.args.visual_profile ?? '').trim()
  const searchStrategy = String(input.args.search_strategy ?? '').trim()

  const response = await editorAgentApi.findBlockMoments(input.projectId, input.sessionId, {
    block_id: blockId,
    search_criteria: searchCriteria,
    max_results: maxResults,
    recall_mode: recallMode,
    ...(visualProfile ? { visual_profile: visualProfile as FindBlockMomentsRequest['visual_profile'] } : {}),
    ...(searchStrategy === 'visual_primary' || searchStrategy === 'text_primary'
      ? { search_strategy: searchStrategy as FindBlockMomentsRequest['search_strategy'] }
      : {}),
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    duration_sec: timelineWindow.duration_sec,
    sample_times_sec: includeVisual ? sampleTimes : [],
    frames: [],
  })

  return {
    block_id: blockId,
    block_title: block.title ?? '',
    search_criteria: searchCriteria,
    duration_sec: timelineWindow.duration_sec,
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    transcript_source: response.transcript_source,
    transcript_segment_count: response.transcript_segment_count,
    visual_frame_count: response.visual_frame_count,
    matches: response.matches,
    note: [formatMomentRecallModeHint(recallMode), response.note].filter(Boolean).join('\n'),
  }
}
