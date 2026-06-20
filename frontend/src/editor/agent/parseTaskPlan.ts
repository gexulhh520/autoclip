import type { AgentTaskItem, AgentTaskPlan, AgentToolCall } from '../../types/editorAgent'

function str(value: unknown): string {
  return String(value ?? '').trim()
}

export function parseSubmitTaskPlan(call: AgentToolCall): AgentTaskPlan | null {
  if (call.name !== 'submit_task_plan') return null
  const goal = str(call.arguments.goal)
  const rawTasks = call.arguments.tasks
  if (!goal || !Array.isArray(rawTasks) || rawTasks.length === 0) return null

  const tasks: AgentTaskItem[] = []
  const seenIds = new Set<string>()
  for (const [index, item] of rawTasks.entries()) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = str(row.id) || `t${index + 1}`
    const title = str(row.title)
    if (!title || seenIds.has(id)) continue
    seenIds.add(id)
    const hint = str(row.hint)
    tasks.push({
      id,
      title,
      hint: hint || undefined,
      status: 'pending',
    })
  }

  if (tasks.length === 0) return null
  return { goal, tasks }
}
