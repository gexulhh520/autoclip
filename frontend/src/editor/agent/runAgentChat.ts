import { buildEditorSnapshot } from './buildEditorSnapshot'
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

function buildSnapshot(layoutReference?: LayoutAnalysis | null) {
  const store = useEditSessionStore.getState()
  const session = store.session
  if (!session) {
    throw new Error('无活动剪辑工程')
  }
  return buildEditorSnapshot({
    session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
    layoutReference: layoutReference ?? undefined,
  })
}

/** 通用 Agent 对话：按需读草稿 → 返回写工具计划或纯文本回复 */
export async function runAgentChat(input: RunAgentChatInput): Promise<RunAgentChatResult> {
  const snapshot = buildSnapshot(input.layoutReference)
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
        const result = executeReadToolCall(() => useEditSessionStore.getState(), call)
        messages.push({
          role: 'tool',
          tool_name: call.name,
          content: JSON.stringify(result),
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

export function confirmExecutePlan(calls: import('../../types/editorAgent').AgentToolCall[]) {
  return useEditSessionStore.getState().executeAgentToolCalls(calls)
}
