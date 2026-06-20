import { formatAgentDebugSummary } from './formatAgentDebug'
import { listTextOverlayPreviews } from './staggeredCharText'
import {
  confirmExecutePlan,
  MAX_TASK_EXEC_ROUNDS,
  runAgentChatLoop,
  type RunAgentChatResult,
} from './runAgentChat'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentTaskPlan,
  LayoutAnalysis,
  PendingAgentPlan,
  AgentDebugTrace,
} from '../../types/editorAgent'

export interface ExecuteAgentTaskPlanInput {
  projectId: string
  sessionId: string
  userGoal: string
  taskPlan: AgentTaskPlan
  layoutReference?: LayoutAnalysis | null
  onProgress?: (plan: AgentTaskPlan) => void
}

export interface ExecuteAgentTaskPlanResult {
  taskPlan: AgentTaskPlan
  assistant_message: string
  pendingPlan: PendingAgentPlan | null
  debug_trace?: AgentDebugTrace
  debug_summary?: string
}

function clonePlan(plan: AgentTaskPlan): AgentTaskPlan {
  return {
    goal: plan.goal,
    tasks: plan.tasks.map((task) => ({ ...task })),
  }
}

function buildCompletionMessage(plan: AgentTaskPlan): string {
  const lines = plan.tasks
    .filter((task) => task.status === 'done' && task.summary)
    .map((task) => `- ${task.summary}`)
  if (lines.length === 0) {
    return '任务列表已执行完成。'
  }
  return `任务列表已完成：\n${lines.join('\n')}`
}

export async function executeAgentTaskPlan(
  input: ExecuteAgentTaskPlanInput
): Promise<ExecuteAgentTaskPlanResult> {
  const plan = clonePlan(input.taskPlan)
  const completedSummaries: string[] = []
  let lastDebug: AgentDebugTrace | undefined

  for (let index = 0; index < plan.tasks.length; index += 1) {
    const current = plan.tasks[index]!
    for (let i = 0; i < plan.tasks.length; i += 1) {
      if (i === index) {
        plan.tasks[i]!.status = 'running'
      } else if (plan.tasks[i]!.status === 'running') {
        plan.tasks[i]!.status = 'pending'
      }
    }
    input.onProgress?.(clonePlan(plan))

    const pendingTasks = plan.tasks.slice(index + 1).map((task) => ({
      id: task.id,
      title: task.title,
    }))

    const session = useEditSessionStore.getState().session
    const knownOverlays = session ? listTextOverlayPreviews(session) : []

    const taskResult: RunAgentChatResult = await runAgentChatLoop(
      {
        projectId: input.projectId,
        sessionId: input.sessionId,
        layoutReference: input.layoutReference,
      },
      [{ role: 'user', content: input.userGoal }],
      {
        maxRounds: MAX_TASK_EXEC_ROUNDS,
        initialOutcome: 'reply',
        exhaustedMessage: `任务「${current.title}」步骤过多，请手动说明还需调整什么。`,
        autoExecuteWrites: true,
        taskContext: {
          user_goal: input.userGoal,
          completed_summaries: completedSummaries,
          current_task: {
            id: current.id,
            title: current.title,
            hint: current.hint,
          },
          pending_tasks: pendingTasks,
          known_overlays: knownOverlays,
        },
      }
    )

    if (taskResult.debug_trace) {
      lastDebug = taskResult.debug_trace
    }

    if (taskResult.plan?.tool_calls.length) {
      current.status = 'failed'
      input.onProgress?.(clonePlan(plan))
      return {
        taskPlan: plan,
        assistant_message: taskResult.assistant_message,
        pendingPlan: taskResult.plan,
        debug_trace: lastDebug,
        debug_summary: taskResult.debug_summary,
      }
    }

    if (taskResult.task_plan) {
      current.status = 'failed'
      input.onProgress?.(clonePlan(plan))
      return {
        taskPlan: plan,
        assistant_message: '执行中不应再生成任务计划，请重试或手动操作。',
        pendingPlan: null,
        debug_trace: lastDebug,
        debug_summary: taskResult.debug_summary,
      }
    }

    const summary = taskResult.assistant_message.trim() || `已完成：${current.title}`
    current.status = 'done'
    current.summary = summary
    completedSummaries.push(`[${current.id}] ${current.title}: ${summary}`)
    input.onProgress?.(clonePlan(plan))
  }

  return {
    taskPlan: plan,
    assistant_message: buildCompletionMessage(plan),
    pendingPlan: null,
    debug_trace: lastDebug,
    debug_summary: lastDebug ? formatAgentDebugSummary(lastDebug) : undefined,
  }
}
