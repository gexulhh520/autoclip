import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import { sanitizeToolResultForChat } from './sanitizeToolResultForChat'
import { executeReadToolCall } from './executeToolCall'
import { isReadOnlyAgentTool, isWriteAgentTool } from './toolRegistry'
import { editorAgentApi } from '../../services/editorAgentApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentChatMessage,
  LayoutAnalysis,
  PendingAgentPlan,
} from '../../types/editorAgent'

const MAX_AGENT_ROUNDS = 5

export interface RunAgentChatInput {
  projectId: string
  sessionId: string
  userMessage: string
  history?: AgentChatMessage[]
  imageDataUrl?: string | null
  layoutReference?: LayoutAnalysis | null
}

export interface RunAgentChatResult {
  assistant_message: string
  history: AgentChatMessage[]
  plan: PendingAgentPlan | null
}

export async function runAgentChat(input: RunAgentChatInput): Promise<RunAgentChatResult> {
  const snapshot = buildEditorSnapshotFromStore(
    () => useEditSessionStore.getState(),
    input.layoutReference
  )
  const trimmed = input.userMessage.trim()
  if (!trimmed && !input.imageDataUrl) {
    throw new Error('请输入需求或附加参考图')
  }

  const userMsg: AgentChatMessage = {
    role: 'user',
    content: trimmed || '请根据附图理解我的剪辑需求。',
    images: input.imageDataUrl ? [input.imageDataUrl] : undefined,
  }

  let messages: AgentChatMessage[] = [...(input.history ?? []), userMsg]

  for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
    const response = await editorAgentApi.chat(input.projectId, input.sessionId, {
      messages,
      snapshot: snapshot as unknown as Record<string, unknown>,
      layout_reference: input.layoutReference ?? undefined,
      max_rounds: 1,
    })

    const readCalls = response.tool_calls.filter((call) => isReadOnlyAgentTool(call.name))
    const writeCalls = response.tool_calls.filter((call) => isWriteAgentTool(call.name))

    if (writeCalls.length > 0) {
      const nextHistory: AgentChatMessage[] = [
        ...messages,
        { role: 'assistant', content: response.assistant_message || '已生成操作计划，请确认执行。' },
      ]
      return {
        assistant_message: response.assistant_message || '已生成操作计划，请确认执行。',
        history: nextHistory,
        plan: {
          summary: response.assistant_message || `将执行 ${writeCalls.length} 个操作`,
          tool_calls: writeCalls,
          source: 'llm',
        },
      }
    }

    if (readCalls.length > 0) {
      messages = [
        ...messages,
        { role: 'assistant', content: response.assistant_message || '' },
      ]
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
    return {
      assistant_message: reply,
      history: [...messages, { role: 'assistant', content: reply }],
      plan: null,
    }
  }

  return {
    assistant_message: '操作步骤较多，请拆分需求后重试。',
    history: messages,
    plan: null,
  }
}

export function confirmExecutePlan(
  calls: import('../../types/editorAgent').AgentToolCall[],
  projectId: string
) {
  return useEditSessionStore.getState().executeAgentToolCalls(calls, { projectId })
}
