import { findBlockMoments } from './findBlockMoments'
import { formatAgentDebugSummary } from './formatAgentDebug'
import type { FindBlockMomentsResult } from './findBlockMoments'
import type { AgentChatMessage } from '../../types/editorAgent'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

const MOMENT_SEARCH_PATTERN =
  /找到|找出|筛选|检索|挑选|哪些.*片段|所有.*片段|打斗|打架|格斗|金句|哲学|传播|共鸣|有感觉|能引起|剪出来|挑.*片段|符合.*条件/

const ANALYZE_ONLY_PATTERN =
  /^(这段|当前片段|这个视频).*(说了什么|讲什么|说什么|内容是什么)|视频内容是什么|画面内容$/

const WRITE_CONFLICT_PATTERN =
  /加字幕|加字|裁剪|去气口|滤镜|删除片段|移动视频|apply_caption|split_text|set_visual_filter/i

export function isMomentSearchRequest(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (WRITE_CONFLICT_PATTERN.test(text)) return false
  if (ANALYZE_ONLY_PATTERN.test(text)) return false
  return MOMENT_SEARCH_PATTERN.test(text)
}

export function formatMomentSearchReply(result: FindBlockMomentsResult): string {
  const lines: string[] = []
  const title = result.block_title || '当前片段'
  lines.push(
    `在「${title}」中检索「${result.search_criteria}」：找到 ${result.matches.length} 处`
  )

  if (result.matches.length === 0) {
    lines.push('')
    lines.push(result.note || '未找到符合条件的时间段，可换描述或确认是否有字幕/预览已加载。')
    return lines.join('\n').trim()
  }

  lines.push('')
  for (const match of result.matches) {
    const score = Math.round(match.match_score * 100)
    const source = match.transcript_source === 'visual' ? '画面' : '文本'
    const preview = match.text_preview || match.match_reason
    lines.push(
      `- ${match.timeline_start_sec.toFixed(1)}–${match.timeline_end_sec.toFixed(1)}s（${source}，匹配 ${score}%）`
    )
    if (preview) lines.push(`  ${preview.slice(0, 160)}`)
    if (match.match_reason && match.match_reason !== preview) {
      lines.push(`  理由：${match.match_reason.slice(0, 100)}`)
    }
  }

  lines.push('')
  lines.push(
    '可用 trim_in_sec / trim_out_sec 配合 update_block_trim 裁切；长段先 split_block_at_playhead 再 trim。'
  )
  if (result.note) {
    lines.push('')
    lines.push(result.note)
  }
  return lines.join('\n').trim()
}

export interface MomentSearchFastPathResult {
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

export async function tryMomentSearchFastPath(input: {
  projectId: string
  sessionId: string
  userMessage: string
  executionLedger?: string[]
  getStore: GetEditStore
}): Promise<MomentSearchFastPathResult | null> {
  if (!isMomentSearchRequest(input.userMessage)) return null

  const store = input.getStore()
  if (!store.session) {
    throw new Error('无活动剪辑工程')
  }

  const data = await findBlockMoments({
    projectId: input.projectId,
    sessionId: input.sessionId,
    session: store.session,
    args: { search_criteria: input.userMessage.trim() },
    selectedBlockId: store.selectedBlockId,
  })

  const assistant_message = formatMomentSearchReply(data)
  const debugTrace = {
    rounds: [
      {
        round: 1,
        read_tools: ['find_block_moments'],
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
