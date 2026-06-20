import { executeReadToolCall } from './executeToolCall'
import { sanitizeToolResultForChat } from './sanitizeToolResultForChat'
import { listTextOverlayPreviews } from './staggeredCharText'
import { MAX_TASK_EXEC_ROUNDS, runAgentChatLoop } from './runAgentChat'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentTaskContext,
  AgentToolCall,
  LayoutAnalysis,
  PendingAgentPlan,
  SubtitleFrameVerdict,
} from '../../types/editorAgent'

export const LAYOUT_WRITE_TOOL_NAMES = new Set([
  'split_text_overlay_by_char',
  'split_text_overlays_by_char',
  'update_overlay_params',
  'add_text_overlay',
  'set_text_animation',
  'batch_apply_text_style',
])

const MAX_VERIFY_FIX_ROUNDS = 4

export function shouldAutoVerifyAfterWrites(toolCalls: AgentToolCall[] | undefined): boolean {
  if (!toolCalls?.length) return false
  return toolCalls.some((call) => LAYOUT_WRITE_TOOL_NAMES.has(call.name))
}

function readVerdictFromToolContent(content: string): SubtitleFrameVerdict | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown> | undefined
    const verdict = data?.verdict as SubtitleFrameVerdict | undefined
    return verdict ?? null
  } catch {
    return null
  }
}

function needsLayoutFix(verdict: SubtitleFrameVerdict | null): boolean {
  if (!verdict) return false
  if (verdict.overflow && verdict.overflow !== 'none') return true
  return verdict.issues.length > 0
}

export interface RunAgentPostTaskVerifyInput {
  projectId: string
  sessionId: string
  userGoal: string
  taskContext: AgentTaskContext
  layoutReference?: LayoutAnalysis | null
}

export interface RunAgentPostTaskVerifyResult {
  summary: string
  verdict: SubtitleFrameVerdict | null
  pendingPlan: PendingAgentPlan | null
}

/** 拆分/改字幕后自动截帧 → 视觉子 Agent → 必要时修正 */
export async function runAgentPostTaskVerify(
  input: RunAgentPostTaskVerifyInput
): Promise<RunAgentPostTaskVerifyResult> {
  const verifyResult = await executeReadToolCall(
    () => useEditSessionStore.getState(),
    { name: 'verify_subtitle_in_frame', arguments: {} },
    { projectId: input.projectId }
  )

  const verifyContent = sanitizeToolResultForChat('verify_subtitle_in_frame', verifyResult)
  const verdict = readVerdictFromToolContent(verifyContent)

  if (!verifyResult.ok) {
    return {
      summary: `视觉验证失败: ${verifyResult.error ?? '未知错误'}`,
      verdict: null,
      pendingPlan: null,
    }
  }

  const verifySummary = verdict?.summary?.trim() || '已截帧分析'
  const overflow = verdict?.overflow ?? 'unknown'

  if (!needsLayoutFix(verdict)) {
    return {
      summary: `视觉验证通过: ${verifySummary} (overflow=${overflow})`,
      verdict,
      pendingPlan: null,
    }
  }

  const session = useEditSessionStore.getState().session
  const knownOverlays = session ? listTextOverlayPreviews(session) : []

  const fixResult = await runAgentChatLoop(
    {
      projectId: input.projectId,
      sessionId: input.sessionId,
      layoutReference: input.layoutReference,
    },
    [
      { role: 'user', content: input.userGoal },
      { role: 'tool', tool_name: 'verify_subtitle_in_frame', content: verifyContent },
      {
        role: 'user',
        content:
          '视觉验证发现字幕排版问题（可能叠在一起或超出画面）。请根据 verdict 修正位置/间距，必要时 update_overlay_params；修正后勿重复 split。',
      },
    ],
    {
      maxRounds: MAX_VERIFY_FIX_ROUNDS,
      initialOutcome: 'reply',
      exhaustedMessage: '视觉验证后的修正步骤过多，请预览时间线后手动说明调整需求。',
      autoExecuteWrites: true,
      taskContext: {
        ...input.taskContext,
        known_overlays: knownOverlays,
      },
    }
  )

  if (fixResult.plan?.tool_calls.length) {
    return {
      summary: `视觉验证: ${verifySummary} (overflow=${overflow})；自动修正需确认: ${fixResult.assistant_message}`,
      verdict,
      pendingPlan: fixResult.plan,
    }
  }

  return {
    summary: `视觉验证: ${verifySummary} (overflow=${overflow})；已尝试修正: ${fixResult.assistant_message}`,
    verdict,
    pendingPlan: null,
  }
}
