import type { AgentTaskItem, AgentToolCall } from '../../types/editorAgent'

const WRITE_INTENT_PATTERN =
  /加|添加|字幕|拆|竖|动画|split_text|add_text|set_text|update_overlay|batch_apply|trim|transform/i

const READ_ONLY_INTENT_PATTERN =
  /识别|确认.*(id|overlay|block)|列出|查询|了解|inspect|get_|list_assets|get_timeline/i

export function taskExpectsTimelineWrites(task: Pick<AgentTaskItem, 'title' | 'hint'>): boolean {
  const text = `${task.title} ${task.hint ?? ''}`.trim()
  if (!text) return false
  if (READ_ONLY_INTENT_PATTERN.test(text) && !WRITE_INTENT_PATTERN.test(text)) {
    return false
  }
  return WRITE_INTENT_PATTERN.test(text)
}

export function isGenericTaskCompletionMessage(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return true
  if (trimmed.length <= 6) return true
  return /^(已完成|完成|ok|done)[。.!]?$/i.test(trimmed)
}

export function buildTaskExecutionMessages(
  userGoal: string,
  task: Pick<AgentTaskItem, 'title' | 'hint'>
): Array<{ role: string; content: string }> {
  const lines = [userGoal, '', `【当前任务】${task.title}`]
  if (task.hint?.trim()) {
    lines.push(`任务提示: ${task.hint.trim()}`)
  }
  if (taskExpectsTimelineWrites(task)) {
    lines.push(
      '本任务须调用写工具改动时间线（如 add_captions_for_blocks、split_text_overlays_by_char、set_text_animation），禁止仅用「已完成」文字回复。'
    )
    if (/每段|每个片段|每条.*片段/.test(task.title) && /字幕|加字|文本/.test(task.title)) {
      lines.push(
        '为多个片段加字幕：必须用 add_captions_for_blocks 一次完成（layout=vertical 可竖排拆字+动画），禁止循环 10+ 次 add_text_overlay。'
      )
    }
  }
  return [{ role: 'user', content: lines.join('\n') }]
}

export function summarizeExecutedWrites(toolCalls: AgentToolCall[] | undefined): string {
  if (!toolCalls?.length) return ''
  return toolCalls.map((call) => call.name).join(', ')
}
