import { capturePreviewFrame } from './capturePreviewFrame'
import { resolveCaptureMaxWidth } from './capturePreviewFrameUtils'
import {
  resolveAnalyzeBlockId,
  resolveBlockTimelineWindow,
  resolveFrameSampleCount,
  resolveSampleTimesSec,
} from './analyzeBlockContentUtils'
import { editorAgentApi } from '../../services/editorAgentApi'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { MatchedMoment } from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

const CAPTURE_BATCH_SIZE = 4

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

async function capturePreviewFramesBatched(input: {
  projectId: string
  session: EditSession
  sampleTimes: number[]
  maxWidth: number
}): Promise<Array<{ time_sec: number; image_base64: string }>> {
  const frames: Array<{ time_sec: number; image_base64: string }> = []
  for (let index = 0; index < input.sampleTimes.length; index += CAPTURE_BATCH_SIZE) {
    const batchTimes = input.sampleTimes.slice(index, index + CAPTURE_BATCH_SIZE)
    const batchFrames = await Promise.all(
      batchTimes.map(async (timeSec) => {
        const frame = await capturePreviewFrame({
          projectId: input.projectId,
          session: input.session,
          timeSec,
          maxWidth: input.maxWidth,
        })
        if (!frame.image_base64?.trim()) {
          throw new Error(`预览截帧为空（@${timeSec.toFixed(2)}s），请确认预览区已加载`)
        }
        return { time_sec: frame.time_sec, image_base64: frame.image_base64 }
      })
    )
    frames.push(...batchFrames)
  }
  return frames.sort((a, b) => a.time_sec - b.time_sec)
}

/** 按用户描述检索片段：转写文本 + 画面抽帧双路径 */
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
      : resolveFrameSampleCount(timelineWindow.duration_sec)
  const sampleTimes = resolveSampleTimesSec(timelineWindow, sampleCount)

  const maxResults = Number.isFinite(Number(input.args.max_results))
    ? Number(input.args.max_results)
    : 12
  const includeVisual = input.args.include_visual !== false

  let frames: Array<{ time_sec: number; image_base64: string }> = []
  if (includeVisual) {
    const maxWidth = resolveCaptureMaxWidth(input.args.max_width)
    frames = await capturePreviewFramesBatched({
      projectId: input.projectId,
      session: input.session,
      sampleTimes,
      maxWidth,
    })
  }

  const response = await editorAgentApi.findBlockMoments(input.projectId, input.sessionId, {
    block_id: blockId,
    search_criteria: searchCriteria,
    max_results: maxResults,
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    duration_sec: timelineWindow.duration_sec,
    sample_times_sec: frames.map((frame) => frame.time_sec),
    frames,
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
    note: response.note,
  }
}
