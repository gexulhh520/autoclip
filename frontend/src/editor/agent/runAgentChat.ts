import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import { formatAgentDebugSummary } from './formatAgentDebug'
import { maskStaleToolObservations } from './maskAgentToolMessages'
import { sanitizeToolResultForChat } from './sanitizeToolResultForChat'
import { executeReadToolCall } from './executeToolCall'
import { isReadOnlyAgentTool, isWriteAgentTool } from './toolRegistry'
import { editorAgentApi } from '../../services/editorAgentApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentChatMessage,
  AgentDebugTrace,
  AgentRoundTrace,
  AgentToolCall,
  AgentToolResult,
  LayoutAnalysis,
  PendingAgentPlan,
} from '../../types/editorAgent'
import type { AgentChatResponse } from '../../types/editorAgent'

/** 读工具多轮 + 写计划；与 §12.7「单次 chat tools ≤12」对齐 */
const MAX_AGENT_ROUNDS = 12

/** 用户确认执行写工具后的验证/修正轮次 */
const MAX_POST_APPLY_ROUNDS = 6

export interface RunAgentChatInput {
  projectId: string
  sessionId: string
  userMessage: string
  history?: AgentChatMessage[]
  imageDataUrl?: string | null
  layoutReference?: LayoutAnalysis | null
}

export interface ContinueAgentChatAfterApplyInput {
  projectId: string
  sessionId: string
  history: AgentChatMessage[]
  toolCalls: AgentToolCall[]
  toolResults: AgentToolResult[]
  layoutReference?: LayoutAnalysis | null
}

export interface RunAgentChatResult {
  assistant_message: string
  history: AgentChatMessage[]
  plan: PendingAgentPlan | null
  debug_trace?: AgentDebugTrace
  debug_summary?: string
}

function recordRound(
  trace: AgentDebugTrace,
  round: number,
  response: AgentChatResponse,
  readTools: string[],
  writeTools: string[],
  context?: AgentRoundTrace['context']
): void {
  trace.rounds.push({
    round,
    finish_reason: response.finish_reason,
    usage: response.usage,
    model: response.model,
    read_tools: readTools,
    write_tools: writeTools,
    debug: response.debug,
    context,
  })
  trace.total_rounds = round
}

function finishResult(
  debugTrace: AgentDebugTrace,
  result: Omit<RunAgentChatResult, 'debug_trace' | 'debug_summary'>
): RunAgentChatResult {
  return {
    ...result,
    debug_trace: debugTrace,
    debug_summary: formatAgentDebugSummary(debugTrace),
  }
}

async function runAgentChatLoop(
  input: {
    projectId: string
    sessionId: string
    layoutReference?: LayoutAnalysis | null
  },
  initialMessages: AgentChatMessage[],
  options: {
    maxRounds: number
    initialOutcome: AgentDebugTrace['outcome']
    exhaustedMessage: string
  }
): Promise<RunAgentChatResult> {
  const getStore = () => useEditSessionStore.getState()
  let messages = initialMessages
  const debugTrace: AgentDebugTrace = {
    rounds: [],
    total_rounds: 0,
    exhausted: false,
    outcome: options.initialOutcome,
  }

  for (let round = 0; round < options.maxRounds; round += 1) {
    const snapshot = buildEditorSnapshotFromStore(getStore, input.layoutReference)
    const { messages: maskedMessages, stats: maskStats } = maskStaleToolObservations(messages)

    const response = await editorAgentApi.chat(input.projectId, input.sessionId, {
      messages: maskedMessages,
      snapshot: snapshot as unknown as Record<string, unknown>,
      layout_reference: input.layoutReference ?? undefined,
      max_rounds: 1,
    })

    const readCalls = response.tool_calls.filter((call) => isReadOnlyAgentTool(call.name))
    const writeCalls = response.tool_calls.filter((call) => isWriteAgentTool(call.name))
    recordRound(
      debugTrace,
      round + 1,
      response,
      readCalls.map((call) => call.name),
      writeCalls.map((call) => call.name),
      {
        tool_messages_chars: maskStats.tool_messages_chars,
        masked_tool_count: maskStats.masked_tool_count,
        tool_round_count: maskStats.tool_round_count,
      }
    )

    if (writeCalls.length > 0) {
      debugTrace.outcome = 'plan'
      const assistantMessage = response.assistant_message || '已生成操作计划，请确认执行。'
      return finishResult(debugTrace, {
        assistant_message: assistantMessage,
        history: [...messages, { role: 'assistant', content: assistantMessage }],
        plan: {
          summary: response.assistant_message || `将执行 ${writeCalls.length} 个操作`,
          tool_calls: writeCalls,
          source: 'llm',
        },
      })
    }

    if (readCalls.length > 0) {
      messages = [...messages, { role: 'assistant', content: response.assistant_message || '' }]
      for (const call of readCalls) {
        const result = await executeReadToolCall(
          () => useEditSessionStore.getState(),
          call,
          { projectId: input.projectId }
        )
        messages.push({
          role: 'tool',
          tool_name: call.name,
          content: sanitizeToolResultForChat(call.name, result),
        })
      }
      continue
    }

    const reply = (response.assistant_message || response.raw_content || '').trim() || '已完成。'
    debugTrace.outcome = 'reply'
    return finishResult(debugTrace, {
      assistant_message: reply,
      history: [...messages, { role: 'assistant', content: reply }],
      plan: null,
    })
  }

  debugTrace.exhausted = true
  debugTrace.outcome = 'exhausted'
  return finishResult(debugTrace, {
    assistant_message: options.exhaustedMessage,
    history: messages,
    plan: null,
  })
}

export async function runAgentChat(input: RunAgentChatInput): Promise<RunAgentChatResult> {
  const trimmed = input.userMessage.trim()
  if (!trimmed && !input.imageDataUrl) {
    throw new Error('请输入需求或附加参考图')
  }

  const userMsg: AgentChatMessage = {
    role: 'user',
    content: trimmed || '请根据附图理解我的剪辑需求。',
    images: input.imageDataUrl ? [input.imageDataUrl] : undefined,
  }

  return runAgentChatLoop(
    input,
    [...(input.history ?? []), userMsg],
    {
      maxRounds: MAX_AGENT_ROUNDS,
      initialOutcome: 'reply',
      exhaustedMessage: '操作步骤较多（读工具轮次已用尽），请简化描述或拆分后重试。',
    }
  )
}

/** 用户确认执行写工具后，注入 tool 结果并继续读→写循环（含 verify） */
export async function continueAgentChatAfterApply(
  input: ContinueAgentChatAfterApplyInput
): Promise<RunAgentChatResult> {
  if (input.toolCalls.length === 0) {
    throw new Error('无写工具执行结果可继续')
  }

  const toolMessages: AgentChatMessage[] = input.toolCalls.map((call, index) => ({
    role: 'tool',
    tool_name: call.name,
    content: sanitizeToolResultForChat(call.name, input.toolResults[index] ?? {
      ok: false,
      tool_name: call.name,
      error: '缺少执行结果',
    }),
  }))

  const messages: AgentChatMessage[] = [
    ...input.history,
    ...toolMessages,
    {
      role: 'user',
      content: '（已执行）请验证字幕/排版效果，必要时修正。',
    },
  ]

  return runAgentChatLoop(
    input,
    messages,
    {
      maxRounds: MAX_POST_APPLY_ROUNDS,
      initialOutcome: 'reply',
      exhaustedMessage: '验证/修正步骤较多，请预览时间线后手动说明还需调整什么。',
    }
  )
}

export function confirmExecutePlan(
  calls: import('../../types/editorAgent').AgentToolCall[],
  projectId: string
) {
  return useEditSessionStore.getState().executeAgentToolCalls(calls, { projectId })
}
