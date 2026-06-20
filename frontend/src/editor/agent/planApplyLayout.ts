import { buildApplyPlanFromLayout } from './buildApplyPlan'
import { buildEditorSnapshot } from './buildEditorSnapshot'
import { executeReadToolCall } from './executeToolCall'
import { isReadOnlyAgentTool, isWriteAgentTool } from './toolRegistry'
import { editorAgentApi } from '../../services/editorAgentApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentChatMessage,
  AgentToolCall,
  LayoutAnalysis,
  PendingAgentPlan,
} from '../../types/editorAgent'

const APPLY_USER_MESSAGE =
  '请根据 layout_reference 的排版样式，将 snapshot.draft_texts 中的文案应用到时间线。' +
  '生成写工具 tool_calls：add_text_overlay（全程 duration）、必要时 set_video_transform。' +
  '禁止抄参考图文字。'

export async function planApplyLayout(input: {
  projectId: string
  sessionId: string
  layout: LayoutAnalysis
  userPrompt?: string
}): Promise<PendingAgentPlan> {
  const store = useEditSessionStore.getState()
  const session = store.session
  if (!session) {
    throw new Error('无活动剪辑工程')
  }

  const snapshot = buildEditorSnapshot({
    session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
    layoutReference: input.layout,
  })

  let messages: AgentChatMessage[] = [
    {
      role: 'user',
      content: (input.userPrompt ?? APPLY_USER_MESSAGE).trim(),
    },
  ]

  for (let round = 0; round < 5; round += 1) {
    try {
      const response = await editorAgentApi.chat(input.projectId, input.sessionId, {
        messages,
        snapshot: snapshot as unknown as Record<string, unknown>,
        layout_reference: input.layout,
        max_rounds: 1,
      })

      const readCalls = response.tool_calls.filter((call) => isReadOnlyAgentTool(call.name))
      const writeCalls = response.tool_calls.filter((call) => isWriteAgentTool(call.name))

      if (writeCalls.length > 0) {
        return {
          summary: response.assistant_message || `将执行 ${writeCalls.length} 个操作`,
          tool_calls: writeCalls,
          source: 'llm',
        }
      }

      if (readCalls.length === 0) {
        break
      }

      messages = [
        ...messages,
        {
          role: 'assistant',
          content: response.assistant_message || '',
        },
      ]

      for (const call of readCalls) {
        const result = executeReadToolCall(() => useEditSessionStore.getState(), call)
        messages.push({
          role: 'tool',
          tool_name: call.name,
          content: JSON.stringify(result),
        })
      }
    } catch {
      break
    }
  }

  const localCalls = buildApplyPlanFromLayout(snapshot, input.layout)
  return {
    summary: `将添加 ${localCalls.filter((c) => c.name === 'add_text_overlay').length} 层文本` +
      (localCalls.some((c) => c.name === 'set_video_transform') ? '，并调整视频构图' : ''),
    tool_calls: localCalls,
    source: 'local',
  }
}

export function confirmExecutePlan(calls: AgentToolCall[]) {
  return useEditSessionStore.getState().executeAgentToolCalls(calls)
}
