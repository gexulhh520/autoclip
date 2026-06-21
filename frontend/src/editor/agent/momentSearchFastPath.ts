import { findBlockMoments } from './findBlockMoments'
import { formatAgentDebugSummary } from './formatAgentDebug'
import type { FindBlockMomentsResult } from './findBlockMoments'
import {
  formatMomentExtractReply,
} from './extractMomentsToTimeline'
import type { AgentChatMessage } from '../../types/editorAgent'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

const MOMENT_SEARCH_PATTERN =
  /找到|找出|筛选|检索|挑选|哪些.*片段|所有.*片段|打斗|打架|格斗|金句|哲学|传播|共鸣|有感觉|能引起|剪出来|挑.*片段|符合.*条件/

const ANALYZE_ONLY_PATTERN =
  /^(这段|当前片段|这个视频).*(说了什么|讲什么|说什么|内容是什么)|视频内容是什么|画面内容$/

const WRITE_CONFLICT_PATTERN =
  /加字幕|加字|去气口|滤镜|删除片段|移动视频|apply_caption|split_text|set_visual_filter/i

const CUT_INTENT_PATTERN = /切割|切出来|裁切|剪出来|拆成|分成.*段|单独剪|裁出来|裁剪出来|提取.*时间线|帮我裁|自动裁/i

const EXTRACT_CACHED_PATTERN =
  /按.*检索|上面的|刚才|这些.*(裁|切|提取)|帮.*(裁|切|提取)|把.*(裁|切|提取)|按检索结果|裁到时间线/i

export function hasCutIntent(message: string): boolean {
  return CUT_INTENT_PATTERN.test(message.trim())
}

export function hasExtractCachedIntent(message: string): boolean {
  return EXTRACT_CACHED_PATTERN.test(message.trim())
}

export function isMomentSearchRequest(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (WRITE_CONFLICT_PATTERN.test(text)) return false
  if (ANALYZE_ONLY_PATTERN.test(text)) return false
  if (hasCutIntent(text)) return false
  if (hasExtractCachedIntent(text)) return false
  return MOMENT_SEARCH_PATTERN.test(text)
}

function cacheMomentSearch(sessionId: string, data: FindBlockMomentsResult): void {
  useAgentPanelStore.getState().setLastMomentSearch(sessionId, {
    blockId: data.block_id,
    blockTitle: data.block_title,
    searchCriteria: data.search_criteria,
    matches: data.matches,
    cachedAt: Date.now(),
  })
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
  lines.push('可以说「按检索结果裁剪到时间线」自动裁出以上片段。')
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

function applyMomentExtract(
  getStore: GetEditStore,
  cached: {
    blockId: string
    blockTitle: string
    searchCriteria: string
    matches: FindBlockMomentsResult['matches']
  }
): { createdBlockIds: string[]; assistant_message: string } {
  const store = getStore()
  const createdBlockIds = store.extractBlocksFromMoments(cached.blockId, cached.matches)
  const assistant_message = formatMomentExtractReply({
    blockTitle: cached.blockTitle,
    searchCriteria: cached.searchCriteria,
    createdCount: createdBlockIds.length,
    matchCount: cached.matches.length,
    createdBlockIds,
  })
  return { createdBlockIds, assistant_message }
}

/** 复用上轮检索结果，直接裁到时间线 */
export async function tryExtractCachedMomentsFastPath(input: {
  sessionId: string
  userMessage: string
  executionLedger?: string[]
  getStore: GetEditStore
}): Promise<MomentSearchFastPathResult | null> {
  if (!hasExtractCachedIntent(input.userMessage)) return null

  const cached = useAgentPanelStore.getState().getLastMomentSearch(input.sessionId)
  if (!cached || cached.matches.length === 0) return null

  const store = input.getStore()
  if (!store.session) {
    throw new Error('无活动剪辑工程')
  }

  const { assistant_message } = applyMomentExtract(getStore, cached)
  const debugTrace = {
    rounds: [{ round: 1, read_tools: [] as string[], write_tools: ['extract_moment_clips'] }],
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

/** 检索 + 自动裁到时间线 */
export async function tryMomentSearchAndExtractFastPath(input: {
  projectId: string
  sessionId: string
  userMessage: string
  executionLedger?: string[]
  getStore: GetEditStore
}): Promise<MomentSearchFastPathResult | null> {
  const text = input.userMessage.trim()
  if (!text || !hasCutIntent(text)) return null
  if (!MOMENT_SEARCH_PATTERN.test(text)) return null
  if (WRITE_CONFLICT_PATTERN.test(text)) return null

  const store = input.getStore()
  if (!store.session) {
    throw new Error('无活动剪辑工程')
  }

  const data = await findBlockMoments({
    projectId: input.projectId,
    sessionId: input.sessionId,
    session: store.session,
    args: { search_criteria: text },
    selectedBlockId: store.selectedBlockId,
  })
  cacheMomentSearch(input.sessionId, data)

  if (data.matches.length === 0) {
    return {
      assistant_message: formatMomentSearchReply(data),
      history: [
        { role: 'user', content: input.userMessage },
        { role: 'assistant', content: formatMomentSearchReply(data) },
      ],
      execution_ledger: input.executionLedger,
      plan: null,
      debug_trace: {
        rounds: [{ round: 1, read_tools: ['find_block_moments'], write_tools: [] }],
        total_rounds: 1,
        exhausted: false,
        outcome: 'reply',
      },
    }
  }

  const { assistant_message } = applyMomentExtract(getStore, {
    blockId: data.block_id,
    blockTitle: data.block_title,
    searchCriteria: data.search_criteria,
    matches: data.matches,
  })

  const debugTrace = {
    rounds: [
      {
        round: 1,
        read_tools: ['find_block_moments'],
        write_tools: ['extract_moment_clips'],
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
  cacheMomentSearch(input.sessionId, data)

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
