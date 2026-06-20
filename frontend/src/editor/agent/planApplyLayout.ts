import { buildApplyPlanFromLayout } from './buildApplyPlan'
import { buildEditorSnapshot } from './buildEditorSnapshot'
import { confirmExecutePlan, runAgentChat } from './runAgentChat'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { LayoutAnalysis, PendingAgentPlan } from '../../types/editorAgent'

const APPLY_USER_MESSAGE =
  '请根据 layout_reference 的排版样式，将 snapshot.draft_texts 中的文案应用到时间线。' +
  '生成写工具 tool_calls：add_text_overlay（全程 duration）、必要时 set_video_transform。' +
  '禁止抄参考图文字。'

export async function planApplyLayout(input: {
  projectId: string
  sessionId: string
  layout: LayoutAnalysis
  userPrompt?: string
  imageDataUrl?: string | null
}): Promise<PendingAgentPlan> {
  try {
    const result = await runAgentChat({
      projectId: input.projectId,
      sessionId: input.sessionId,
      userMessage: (input.userPrompt ?? APPLY_USER_MESSAGE).trim(),
      layoutReference: input.layout,
      imageDataUrl: input.imageDataUrl,
    })
    if (result.plan?.tool_calls.length) {
      return result.plan
    }
  } catch {
    // fallback below
  }

  const store = useEditSessionStore.getState()
  if (!store.session) throw new Error('无活动剪辑工程')

  const snapshot = buildEditorSnapshot({
    session: store.session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
    layoutReference: input.layout,
  })

  const localCalls = buildApplyPlanFromLayout(snapshot, input.layout)
  return {
    summary: `将添加 ${localCalls.filter((c) => c.name === 'add_text_overlay').length} 层文本` +
      (localCalls.some((c) => c.name === 'set_video_transform') ? '，并调整视频构图' : ''),
    tool_calls: localCalls,
    source: 'local',
  }
}

export { confirmExecutePlan }
