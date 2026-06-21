import { resolveCanvasDimensions } from '../scene/canvas'
import { capturePreviewFrame } from './capturePreviewFrame'
import { resolveCaptureMaxWidth } from './capturePreviewFrameUtils'
import { getBlockDetail } from './buildEditorSnapshot'
import {
  resolveAnalyzeBlockId,
  resolveBlockTimelineWindow,
  resolveSampleTimesSec,
  summarizeAudioSegments,
} from './analyzeBlockContentUtils'
import { editorAgentApi } from '../../services/editorAgentApi'
import editApi from '../../services/editApi'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { VideoContentAnalysis } from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

export interface AnalyzeBlockContentResult {
  block_id: string
  block_title: string
  duration_sec: number
  timeline_start_sec: number
  timeline_end_sec: number
  sample_times_sec: number[]
  trim: { in_sec: number; out_sec: number }
  existing_text?: {
    outline_preview: string
    content_preview: string
  }
  audio_analysis?: ReturnType<typeof summarizeAudioSegments>
  audio_analysis_error?: string
  visual_analysis: VideoContentAnalysis
  vision_model?: string
  note: string
}

function readBoolArg(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value !== 'false' && value !== '0'
  return Boolean(value)
}

/** 静音分段 + 多帧抽帧，委派视觉子 Agent 分析片段内容 */
export async function analyzeBlockContent(input: {
  projectId: string
  sessionId: string
  session: EditSession
  args: Record<string, unknown>
  selectedBlockId: string | null
}): Promise<AnalyzeBlockContentResult> {
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

  const timelineWindow = resolveBlockTimelineWindow(input.session, blockId)
  if (!timelineWindow) {
    throw new Error(`无法解析片段时间范围: ${blockId}`)
  }

  const sampleCount = Number.isFinite(Number(input.args.frame_sample_count))
    ? Number(input.args.frame_sample_count)
    : 3
  const sampleTimes = resolveSampleTimesSec(timelineWindow, sampleCount)
  const includeAudio = readBoolArg(input.args.include_audio_analysis, true)
  const includeExistingText = readBoolArg(input.args.include_existing_text, true)
  const userQuestion = String(input.args.user_question ?? '').trim()

  let audioAnalysis: ReturnType<typeof summarizeAudioSegments> | undefined
  let audioAnalysisError: string | undefined
  if (includeAudio) {
    try {
      const silence = await editApi.detectSilence(input.projectId, input.sessionId, {
        block_id: blockId,
        noise_db: Number.isFinite(Number(input.args.noise_db))
          ? Number(input.args.noise_db)
          : undefined,
        min_silence_sec: Number.isFinite(Number(input.args.min_silence_sec))
          ? Number(input.args.min_silence_sec)
          : undefined,
      })
      audioAnalysis = summarizeAudioSegments(
        block,
        silence.silence_regions,
        silence.split_points,
        silence.suggested_trim
      )
    } catch (error) {
      audioAnalysisError = error instanceof Error ? error.message : String(error)
    }
  }

  const maxWidth = resolveCaptureMaxWidth(input.args.max_width)
  const capturedFrames = await Promise.all(
    sampleTimes.map(async (timeSec) => {
      const frame = await capturePreviewFrame({
        projectId: input.projectId,
        session: input.session,
        timeSec,
        maxWidth,
      })
      if (!frame.image_base64?.trim()) {
        throw new Error(`预览截帧为空（@${timeSec.toFixed(2)}s），请确认预览区已加载`)
      }
      return {
        time_sec: frame.time_sec,
        image_base64: frame.image_base64,
        width: frame.width,
        height: frame.height,
      }
    })
  )
  const frames = capturedFrames.sort((a, b) => a.time_sec - b.time_sec)

  const detail = getBlockDetail(input.session, blockId)
  const existingText =
    includeExistingText && detail?.overlay
      ? {
          outline_preview: String(detail.overlay.outline ?? '').slice(0, 240),
          content_preview: Array.isArray(detail.overlay.content)
            ? detail.overlay.content.join(' ').trim().slice(0, 400)
            : '',
        }
      : undefined

  const dims = resolveCanvasDimensions(input.session.export_settings)
  const analysis = await editorAgentApi.analyzeVideoContent(input.projectId, input.sessionId, {
    block_id: blockId,
    block_title: block.title ?? '',
    duration_sec: timelineWindow.duration_sec,
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    trim: { in_sec: block.trim.in_sec, out_sec: block.trim.out_sec },
    sample_times_sec: frames.map((frame) => frame.time_sec),
    frames: frames.map((frame) => ({
      time_sec: frame.time_sec,
      image_base64: frame.image_base64,
    })),
    aspect: input.session.export_settings.aspect,
    canvas_width: dims.width,
    canvas_height: dims.height,
    audio_analysis: audioAnalysis,
    existing_text: existingText,
    user_question: userQuestion || undefined,
  })

  return {
    block_id: blockId,
    block_title: block.title ?? '',
    duration_sec: timelineWindow.duration_sec,
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    sample_times_sec: frames.map((frame) => frame.time_sec),
    trim: { in_sec: block.trim.in_sec, out_sec: block.trim.out_sec },
    existing_text: existingText,
    audio_analysis: audioAnalysis,
    audio_analysis_error: audioAnalysisError,
    visual_analysis: analysis.analysis,
    vision_model: analysis.model,
    note: audioAnalysisError
      ? `画面单帧并发视觉分析 + 音频分段并发节奏分析，最后文本汇总；音频分段失败：${audioAnalysisError}`
      : '画面单帧并发视觉分析 + 音频分段并发节奏分析，最后文本汇总；JPEG 未写入主对话',
  }
}
