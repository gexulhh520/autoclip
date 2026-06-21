import { formatAgentDebugSummary } from './formatAgentDebug'
import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import {
  runAgentPostTaskVerify,
  shouldAutoVerifyAfterWrites,
} from './runAgentPostTaskVerify'
import { listTextOverlayPreviews } from './staggeredCharText'
import {
  buildTaskExecutionMessages,
  isGenericTaskCompletionMessage,
  summarizeExecutedWrites,
  taskExpectsTimelineWrites,
} from './taskExecutionGuard'
import {
  confirmExecutePlan,
  MAX_TASK_EXEC_ROUNDS,
  runAgentChatLoop,
  type RunAgentChatResult,
} from './runAgentChat'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type {
  AgentDebugTrace,
  AgentTaskItem,
  AgentTaskPlan,
  LayoutAnalysis,
  PendingAgentPlan,
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

function mergeDebugTraces(traces: AgentDebugTrace[]): AgentDebugTrace | undefined {
  if (traces.length === 0) return undefined
  const merged: AgentDebugTrace = {
    rounds: [],
    total_rounds: 0,
    exhausted: traces.some((trace) => trace.exhausted),
    outcome: 'reply',
  }
  for (const trace of traces) {
    for (const round of trace.rounds) {
      merged.rounds.push({
        ...round,
        round: merged.rounds.length + 1,
      })
    }
    merged.total_rounds = merged.rounds.length
    if (trace.outcome === 'plan' || trace.outcome === 'exhausted') {
      merged.outcome = trace.outcome
    }
  }
  return merged
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

async function runSingleTaskLoop(
  input: ExecuteAgentTaskPlanInput,
  current: AgentTaskItem,
  completedSummaries: string[],
  pendingTasks: Array<{ id: string; title: string }>,
  taskContext: import('../../types/editorAgent').AgentTaskContext
): Promise<RunAgentChatResult> {
  const baseMessages = buildTaskExecutionMessages(input.userGoal, current)

  let taskResult = await runAgentChatLoop(
    {
      projectId: input.projectId,
      sessionId: input.sessionId,
      layoutReference: input.layoutReference,
    },
    baseMessages,
    {
      maxRounds: MAX_TASK_EXEC_ROUNDS,
      initialOutcome: 'reply',
      exhaustedMessage: `任务「${current.title}」步骤过多，请手动说明还需调整什么。`,
      autoExecuteWrites: true,
      taskContext,
    }
  )

  const expectsWrites = taskExpectsTimelineWrites(current)
  const hasWrites = (taskResult.executed_writes?.length ?? 0) > 0

  if (
    expectsWrites &&
    !hasWrites &&
    !taskResult.plan?.tool_calls.length &&
    !taskResult.task_plan
  ) {
    taskResult = await runAgentChatLoop(
      {
        projectId: input.projectId,
        sessionId: input.sessionId,
        layoutReference: input.layoutReference,
      },
      [
        ...baseMessages,
        { role: 'assistant', content: taskResult.assistant_message || '（无写操作）' },
        {
          role: 'user',
          content:
            '上一轮未改动时间线。你必须在本轮输出写 tool_calls（如 add_text_overlay / split_text_overlays_by_char / set_text_animation）完成「' +
            current.title +
            '」，不要只说已完成。',
        },
      ],
      {
        maxRounds: MAX_TASK_EXEC_ROUNDS,
        initialOutcome: 'reply',
        exhaustedMessage: `任务「${current.title}」重试后仍未完成写操作。`,
        autoExecuteWrites: true,
        taskContext,
      }
    )
  }

  return taskResult
}

function buildTaskFailureSummary(
  current: AgentTaskItem,
  taskResult: RunAgentChatResult
): string {
  const writes = summarizeExecutedWrites(taskResult.executed_writes)
  if (writes) {
    return taskResult.assistant_message.trim() || `已执行写工具: ${writes}`
  }
  if (isGenericTaskCompletionMessage(taskResult.assistant_message)) {
    return `任务「${current.title}」未执行写操作（模型仅回复已完成，时间线未变）`
  }
  return taskResult.assistant_message.trim() || `任务「${current.title}」未完成写操作`
}

export async function executeAgentTaskPlan(
  input: ExecuteAgentTaskPlanInput
): Promise<ExecuteAgentTaskPlanResult> {
  const plan = clonePlan(input.taskPlan)
  const completedSummaries: string[] = []
  const debugTraces: AgentDebugTrace[] = []

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

    const snapshot = buildEditorSnapshotFromStore(
      () => useEditSessionStore.getState(),
      input.layoutReference
    )
    const session = useEditSessionStore.getState().session
    const knownOverlays = session ? listTextOverlayPreviews(session) : []
    const knownBlocks = snapshot.blocks.map((block) => ({
      id: block.id,
      title: block.title,
      timeline_start_sec: block.timeline_start_sec,
      timeline_end_sec: block.timeline_end_sec,
      duration_sec: block.duration_sec,
    }))

    const taskContext = {
      user_goal: input.userGoal,
      completed_summaries: completedSummaries,
      current_task: {
        id: current.id,
        title: current.title,
        hint: current.hint,
      },
      pending_tasks: pendingTasks,
      known_overlays: knownOverlays,
      known_blocks: knownBlocks,
    }

    const taskResult = await runSingleTaskLoop(
      input,
      current,
      completedSummaries,
      pendingTasks,
      taskContext
    )

    if (taskResult.debug_trace) {
      debugTraces.push(taskResult.debug_trace)
    }

    if (taskResult.plan?.tool_calls.length) {
      current.status = 'failed'
      input.onProgress?.(clonePlan(plan))
      return {
        taskPlan: plan,
        assistant_message: taskResult.assistant_message,
        pendingPlan: taskResult.plan,
        debug_trace: mergeDebugTraces(debugTraces),
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
        debug_trace: mergeDebugTraces(debugTraces),
        debug_summary: taskResult.debug_summary,
      }
    }

    const expectsWrites = taskExpectsTimelineWrites(current)
    const hasWrites = (taskResult.executed_writes?.length ?? 0) > 0
    if (expectsWrites && !hasWrites) {
      current.status = 'failed'
      const failureSummary = buildTaskFailureSummary(current, taskResult)
      current.summary = failureSummary
      input.onProgress?.(clonePlan(plan))
      return {
        taskPlan: plan,
        assistant_message: `任务执行中断：${failureSummary}`,
        pendingPlan: null,
        debug_trace: mergeDebugTraces(debugTraces),
        debug_summary: taskResult.debug_summary,
      }
    }

    let summary = buildTaskFailureSummary(current, taskResult)
    const writeNote = summarizeExecutedWrites(taskResult.executed_writes)
    if (writeNote) {
      summary = `${summary}（写工具: ${writeNote}）`
    }

    if (shouldAutoVerifyAfterWrites(taskResult.executed_writes)) {
      const verify = await runAgentPostTaskVerify({
        projectId: input.projectId,
        sessionId: input.sessionId,
        userGoal: input.userGoal,
        layoutReference: input.layoutReference,
        taskContext: {
          ...taskContext,
          known_overlays: session ? listTextOverlayPreviews(session) : [],
        },
      })
      summary = `${summary}\n${verify.summary}`
      if (verify.pendingPlan?.tool_calls.length) {
        current.status = 'failed'
        current.summary = summary
        input.onProgress?.(clonePlan(plan))
        return {
          taskPlan: plan,
          assistant_message: summary,
          pendingPlan: verify.pendingPlan,
          debug_trace: mergeDebugTraces(debugTraces),
          debug_summary: taskResult.debug_summary,
        }
      }
    }

    current.status = 'done'
    current.summary = summary
    completedSummaries.push(`[${current.id}] ${current.title}: ${summary}`)
    input.onProgress?.(clonePlan(plan))
  }

  const mergedDebug = mergeDebugTraces(debugTraces)
  return {
    taskPlan: plan,
    assistant_message: buildCompletionMessage(plan),
    pendingPlan: null,
    debug_trace: mergedDebug,
    debug_summary: mergedDebug ? formatAgentDebugSummary(mergedDebug) : undefined,
  }
}

export { confirmExecutePlan }
