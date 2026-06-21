import { analyzeBlockContent } from './analyzeBlockContent'
import { formatAgentDebugSummary } from './formatAgentDebug'
import type { AnalyzeBlockContentResult } from './analyzeBlockContent'
import type { AgentChatMessage } from '../../types/editorAgent'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

const CONTENT_ANALYSIS_PATTERN =
  /分析.*(视频|片段).*(内容|说什么|讲什么)|(?:这段|当前片段|这个视频|视频)(说了什么|讲什么|说什么|内容)|视频内容|画面内容|这段.*什么/

const WRITE_CONFLICT_PATTERN =
  /加字幕|加字|裁剪|去气口|滤镜|删除片段|移动视频|apply_caption|split_text|set_visual_filter/i

export function isContentAnalysisRequest(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (WRITE_CONFLICT_PATTERN.test(text)) return false
  return CONTENT_ANALYSIS_PATTERN.test(text)
}

export function formatContentAnalysisReply(result: AnalyzeBlockContentResult): string {
  const visual = result.visual_analysis
  const lines: string[] = []

  const title = result.block_title || '当前片段'
  lines.push(`「${title}」约 ${result.duration_sec.toFixed(1)} 秒（时间线 ${result.timeline_start_sec.toFixed(1)}–${result.timeline_end_sec.toFixed(1)}s）`)

  if (visual.summary) {
    lines.push('')
    lines.push(visual.summary)
  }

  if (visual.subjects?.length) {
    lines.push('')
    lines.push(`画面主体：${visual.subjects.join('、')}`)
  }

  if (visual.scene_types?.length) {
    lines.push(`场景类型：${visual.scene_types.join('、')}`)
  }

  if (visual.mood) {
    lines.push(`氛围：${visual.mood}`)
  }

  if (visual.key_moments?.length) {
    lines.push('')
    lines.push('关键画面：')
    for (const moment of visual.key_moments.slice(0, 5)) {
      const desc = String(moment.description ?? '').trim()
      if (!desc) continue
      lines.push(`- ${Number(moment.time_sec).toFixed(1)}s：${desc}`)
    }
  }

  const audio = result.audio_analysis
  if (audio) {
    lines.push('')
    lines.push(
      `音频节奏：口播占比约 ${Math.round(audio.speech_ratio * 100)}%，静音合计 ${audio.total_silence_sec}s（${audio.silence_region_count} 处停顿）`
    )
    if (audio.split_points.length > 0) {
      lines.push(
        `可参考切分点：${audio.split_points
          .map((sec) => `${sec.toFixed(1)}s`)
          .join('、')}`
      )
    }
  } else if (result.audio_analysis_error) {
    lines.push('')
    lines.push(`（音频分段未成功：${result.audio_analysis_error}）`)
  }

  if (result.existing_text?.content_preview) {
    lines.push('')
    lines.push(`已有文案节选：${result.existing_text.content_preview.slice(0, 160)}`)
  }

  if (visual.editing_suggestions?.length) {
    lines.push('')
    lines.push('剪辑建议：')
    for (const tip of visual.editing_suggestions.slice(0, 4)) {
      lines.push(`- ${tip}`)
    }
  }

  return lines.join('\n').trim()
}

export interface ContentAnalysisFastPathResult {
  assistant_message: string
  history: AgentChatMessage[]
  execution_ledger?: string[]
  plan: null
  debug_trace: {
    rounds: Array<{ round: number; read_tools: string[]; write_tools: string[] }>
    total_rounds: number
    exhausted: boolean
    outcome: 'reply'
  }
  debug_summary?: string
}

export async function tryContentAnalysisFastPath(input: {
  projectId: string
  sessionId: string
  userMessage: string
  executionLedger?: string[]
  getStore: GetEditStore
}): Promise<ContentAnalysisFastPathResult | null> {
  if (!isContentAnalysisRequest(input.userMessage)) return null

  const store = input.getStore()
  if (!store.session) {
    throw new Error('无活动剪辑工程')
  }

  const data = await analyzeBlockContent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    session: store.session,
    args: { user_question: input.userMessage },
    selectedBlockId: store.selectedBlockId,
  })

  const assistant_message = formatContentAnalysisReply(data)
  const debugTrace = {
    rounds: [
      {
        round: 1,
        read_tools: ['analyze_block_content'],
        write_tools: [] as string[],
      },
    ],
    total_rounds: 1,
    exhausted: false,
    outcome: 'reply' as const,
  }

  return {
    assistant_message,
    history: [
      { role: 'user', content: input.userMessage },
      { role: 'assistant', content: assistant_message },
    ],
    execution_ledger: input.executionLedger,
    plan: null,
    debug_trace: debugTrace,
    debug_summary: formatAgentDebugSummary(debugTrace),
  }
}
