import { findBlockMoments } from './findBlockMoments'
import { formatMomentSearchReply } from './momentSearchFastPath'
import { tryContentAnalysisFastPath } from './contentAnalysisFastPath'
import { tryExtractCachedMomentsFastPath } from './momentSearchFastPath'
import {
  applyMomentExtractToPool,
  applyMomentExtractToTimeline,
} from './applyMomentExport'
import { formatAgentDebugSummary } from './formatAgentDebug'
import { resolveMomentRecallMode } from './momentRecallMode'
import { editorAgentApi } from '../../services/editorAgentApi'
import type { AgentChatMessage, ClassifyAgentIntentResponse } from '../../types/editorAgent'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { MomentSearchFastPathResult } from './momentSearchFastPath'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export const INTENT_ROUTE_CONFIDENCE = 0.65

function cacheMomentSearch(
  sessionId: string,
  data: Awaited<ReturnType<typeof findBlockMoments>>
): void {
  useAgentPanelStore.getState().setLastMomentSearch(sessionId, {
    blockId: data.block_id,
    blockTitle: data.block_title,
    searchCriteria: data.search_criteria,
    matches: data.matches,
    cachedAt: Date.now(),
  })
}

function buildIntentDebugTrace(
  readTools: string[],
  writeTools: string[] = []
): MomentSearchFastPathResult['debug_trace'] {
  return {
    rounds: [{ round: 1, read_tools: readTools, write_tools: writeTools }],
    total_rounds: 1,
    exhausted: false,
    outcome: 'reply',
  }
}

async function runFindMomentsFromIntent(input: {
  projectId: string
  sessionId: string
  userMessage: string
  intent: ClassifyAgentIntentResponse
  executionLedger?: string[]
  getStore: GetEditStore
  onStreamingUpdate?: (content: string) => void
}): Promise<MomentSearchFastPathResult> {
  const store = input.getStore()
  if (!store.session) throw new Error('无活动剪辑工程')

  const searchCriteria =
    input.intent.search_criteria?.trim() || input.userMessage.trim()
  const recallMode =
    input.intent.recall_mode === 'high' || input.intent.recall_mode === 'balanced'
      ? input.intent.recall_mode
      : resolveMomentRecallMode({
          sessionId: input.sessionId,
          session: store.session,
          blockId:
            useAgentPanelStore.getState().getFocusedBlockId(input.sessionId) ??
            store.selectedBlockId ??
            '',
          searchCriteria,
        })

  const data = await findBlockMoments({
    projectId: input.projectId,
    sessionId: input.sessionId,
    session: store.session,
    args: {
      search_criteria: searchCriteria,
      recall_mode: recallMode,
      visual_profile: input.intent.visual_profile,
      search_strategy: input.intent.search_strategy,
    },
    selectedBlockId: store.selectedBlockId,
    onProgress: input.onStreamingUpdate
      ? (message) => input.onStreamingUpdate!(message)
      : undefined,
  })
  cacheMomentSearch(input.sessionId, data)

  const exportTarget = input.intent.export_target
  if (data.matches.length > 0 && exportTarget === 'pool') {
    const result = await applyMomentExtractToPool(input.getStore, {
      projectId: input.projectId,
      sessionId: input.sessionId,
      blockId: data.block_id,
      blockTitle: data.block_title,
      searchCriteria: data.search_criteria,
      matches: data.matches,
    })
    useAgentPanelStore.getState().clearLastMomentSearch(input.sessionId)
    const debugTrace = buildIntentDebugTrace(
      ['classify_intent', 'find_block_moments'],
      ['export_moment_clips_to_pool']
    )
    return {
      assistant_message: result.assistant_message,
      history: [
        { role: 'user', content: input.userMessage },
        { role: 'assistant', content: result.assistant_message },
      ],
      execution_ledger: input.executionLedger,
      plan: null,
      debug_trace: debugTrace,
      debug_summary: formatAgentDebugSummary(debugTrace),
    }
  }

  if (data.matches.length > 0 && exportTarget === 'timeline') {
    const result = applyMomentExtractToTimeline(input.getStore, {
      blockId: data.block_id,
      blockTitle: data.block_title,
      searchCriteria: data.search_criteria,
      matches: data.matches,
    })
    useAgentPanelStore.getState().clearLastMomentSearch(input.sessionId)
    const debugTrace = buildIntentDebugTrace(
      ['classify_intent', 'find_block_moments'],
      ['extract_moment_clips']
    )
    return {
      assistant_message: result.assistant_message,
      history: [
        { role: 'user', content: input.userMessage },
        { role: 'assistant', content: result.assistant_message },
      ],
      execution_ledger: input.executionLedger,
      plan: null,
      debug_trace: debugTrace,
      debug_summary: formatAgentDebugSummary(debugTrace),
    }
  }

  const assistant_message = [
    formatMomentSearchReply(data),
    input.intent.reason ? `\n（路由：${input.intent.reason}）` : '',
  ]
    .join('')
    .trim()
  const debugTrace = buildIntentDebugTrace(['classify_intent', 'find_block_moments'])
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

/** LLM 意图路由：优先于关键词 fast path */
export async function tryLlmIntentRoute(input: {
  projectId: string
  sessionId: string
  userMessage: string
  executionLedger?: string[]
  getStore: GetEditStore
  onStreamingUpdate?: (content: string) => void
}): Promise<MomentSearchFastPathResult | null> {
  const text = input.userMessage.trim()
  if (!text) return null

  let intent: ClassifyAgentIntentResponse
  try {
    intent = await editorAgentApi.classifyIntent(input.projectId, input.sessionId, {
      user_message: text,
    })
  } catch {
    return null
  }

  if (intent.confidence < INTENT_ROUTE_CONFIDENCE) {
    return null
  }

  switch (intent.mode) {
    case 'find_moments':
      return runFindMomentsFromIntent({ ...input, intent })
    case 'analyze_content':
      return tryContentAnalysisFastPath({
        projectId: input.projectId,
        sessionId: input.sessionId,
        userMessage: text,
        executionLedger: input.executionLedger,
        getStore: input.getStore,
      })
    case 'export_cached_moments':
      return tryExtractCachedMomentsFastPath({
        projectId: input.projectId,
        sessionId: input.sessionId,
        userMessage: text,
        executionLedger: input.executionLedger,
        getStore: input.getStore,
      })
    default:
      return null
  }
}
