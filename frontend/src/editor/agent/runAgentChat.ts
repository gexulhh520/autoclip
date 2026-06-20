import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import { formatAgentDebugSummary } from './formatAgentDebug'
import { maskStaleToolObservations } from './maskAgentToolMessages'
import { parseSubmitTaskPlan } from './parseTaskPlan'
import { sanitizeToolResultForChat } from './sanitizeToolResultForChat'
import { executeReadToolCall } from './executeToolCall'
import { isDangerousAgentTool, isMetaAgentTool, isReadOnlyAgentTool, isWriteAgentTool } from './toolRegistry'
import { editorAgentApi } from '../../services/editorAgentApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentChatMessage,
  AgentDebugTrace,
  AgentRoundTrace,
  AgentTaskContext,
  AgentTaskPlan,
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

/** 单任务执行轮次上限 */
const MAX_TASK_EXEC_ROUNDS = 8

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
  task_plan?: AgentTaskPlan | null
  executed_writes?: AgentToolCall[]
  debug_trace?: AgentDebugTrace
  debug_summary?: string
}

interface AgentLoopInput {
  projectId: string
  sessionId: string
  layoutReference?: LayoutAnalysis | null
}

interface AgentLoopOptions {
  maxRounds: number
  initialOutcome: AgentDebugTrace['outcome']
  exhaustedMessage: string
  allowTaskPlan?: boolean
  autoExecuteWrites?: boolean
  taskContext?: AgentTaskContext
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
  result: Omit<RunAgentChatResult, 'debug_trace' | 'debug_summary'>,
  executedWrites?: AgentToolCall[]
): RunAgentChatResult {
  return {
    ...result,
    executed_writes: executedWrites,
    debug_trace: debugTrace,
    debug_summary: formatAgentDebugSummary(debugTrace),
  }
}

function buildToolMessages(
  toolCalls: AgentToolCall[],
  toolResults: AgentToolResult[]
): AgentChatMessage[] {
  return toolCalls.map((call, index) => ({
    role: 'tool',
    tool_name: call.name,
    content: sanitizeToolResultForChat(
      call.name,
      toolResults[index] ?? { ok: false, tool_name: call.name, error: '缺少执行结果' }
    ),
  }))
}

export async function runAgentChatLoop(
  input: AgentLoopInput,
  initialMessages: AgentChatMessage[],
  options: AgentLoopOptions
): Promise<RunAgentChatResult> {
  const getStore = () => useEditSessionStore.getState()
  let messages = initialMessages
  let executedWrites: AgentToolCall[] = []
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
      task_context: options.taskContext,
      max_rounds: 1,
    })

    const metaCalls = response.tool_calls.filter((call) => isMetaAgentTool(call.name))
    const readCalls = response.tool_calls.filter((call) => isReadOnlyAgentTool(call.name))
    const writeCalls = response.tool_calls.filter((call) => isWriteAgentTool(call.name))

    recordRound(
      debugTrace,
      round + 1,
      response,
      readCalls.map((call) => call.name),
      [...metaCalls, ...writeCalls].map((call) => call.name),
      {
        tool_messages_chars: maskStats.tool_messages_chars,
        masked_tool_count: maskStats.masked_tool_count,
        tool_round_count: maskStats.tool_round_count,
      }
    )

    if (options.allowTaskPlan && metaCalls.length > 0) {
      const parsed = parseSubmitTaskPlan(metaCalls[0]!)
      if (parsed) {
        debugTrace.outcome = 'task_plan'
        const assistantMessage =
          response.assistant_message || `已生成 ${parsed.tasks.length} 步任务计划，请确认后开始执行。`
        return finishResult(
          debugTrace,
          {
            assistant_message: assistantMessage,
            history: [...messages, { role: 'assistant', content: assistantMessage }],
            plan: null,
            task_plan: parsed,
          },
          executedWrites
        )
      }
    }

    if (writeCalls.length > 0) {
      const hasDangerous = writeCalls.some((call) => isDangerousAgentTool(call.name))
      if (options.autoExecuteWrites && !hasDangerous) {
        const results = await confirmExecutePlan(writeCalls, input.projectId)
        const failed = results.find((item) => !item.ok)
        if (failed) {
          debugTrace.outcome = 'plan'
          return finishResult(
            debugTrace,
            {
              assistant_message: failed.error ?? '任务内写操作失败',
              history: messages,
              plan: {
                summary: failed.error ?? '部分操作失败',
                tool_calls: writeCalls,
                source: 'llm',
              },
            },
            executedWrites
          )
        }
        executedWrites = [...executedWrites, ...writeCalls]
        messages = [
          ...messages,
          { role: 'assistant', content: response.assistant_message || '' },
          ...buildToolMessages(writeCalls, results),
        ]
        continue
      }

      debugTrace.outcome = 'plan'
      const assistantMessage = response.assistant_message || '已生成操作计划，请确认执行。'
      return finishResult(
        debugTrace,
        {
          assistant_message: assistantMessage,
          history: [...messages, { role: 'assistant', content: assistantMessage }],
          plan: {
            summary: response.assistant_message || `将执行 ${writeCalls.length} 个操作`,
            tool_calls: writeCalls,
            source: 'llm',
          },
        },
        executedWrites
      )
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
    return finishResult(
      debugTrace,
      {
        assistant_message: reply,
        history: [...messages, { role: 'assistant', content: reply }],
        plan: null,
      },
      executedWrites
    )
  }

  debugTrace.exhausted = true
  debugTrace.outcome = 'exhausted'
  return finishResult(
    debugTrace,
    {
      assistant_message: options.exhaustedMessage,
      history: messages,
      plan: null,
    },
    executedWrites
  )
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
      allowTaskPlan: true,
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

  const messages: AgentChatMessage[] = [
    ...input.history,
    ...buildToolMessages(input.toolCalls, input.toolResults),
    {
      role: 'user',
      content: '（已执行）请验证字幕/排版效果，必要时修正。',
    },
  ]

  return runAgentChatLoop(input, messages, {
    maxRounds: MAX_POST_APPLY_ROUNDS,
    initialOutcome: 'reply',
    exhaustedMessage: '验证/修正步骤较多，请预览时间线后手动说明还需调整什么。',
  })
}

export function confirmExecutePlan(calls: AgentToolCall[], projectId: string) {
  return useEditSessionStore.getState().executeAgentToolCalls(calls, { projectId })
}

export { MAX_TASK_EXEC_ROUNDS }
