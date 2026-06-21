import type { AgentTaskItem, AgentToolCall } from '../../types/editorAgent'

const WRITE_INTENT_PATTERN =
  /加|添加|字幕|拆|竖|动画|split_text|add_text|set_text|update_overlay|batch_apply|trim|transform/i

const READ_ONLY_INTENT_PATTERN =
  /识别|确认.*(id|overlay|block)|列出|查询|了解|inspect|get_|list_assets|get_timeline|获取|详情|文本内容/i

export function isPostCaptionAnimationTask(
  task: Pick<AgentTaskItem, 'title' | 'hint'>,
  completedSummaries: string[]
): boolean {
  const text = `${task.title} ${task.hint ?? ''}`
  if (!/动画|入场/.test(text)) return false
  if (/添加文本|加字幕|文案/.test(text)) return false
  return completedSummaries.some((item) =>
    /竖排字幕|apply_caption_template|add_captions_for_blocks|已.*段.*字幕|拆字/.test(item)
  )
}

export function taskExpectsTimelineWrites(
  task: Pick<AgentTaskItem, 'title' | 'hint'>,
  completedSummaries?: string[]
): boolean {
  if (completedSummaries && isPostCaptionAnimationTask(task, completedSummaries)) {
    return false
  }
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
      '本任务须调用写工具改动时间线（如 apply_caption_template、split_text_overlays_by_char），禁止仅用「已完成」文字回复。'
    )
    if (
      /每段|各段|各片段|每个片段|每条.*片段|所有片段|各视频|每段视频/.test(
        `${task.title} ${userGoal}`
      ) &&
      /字幕|加字|文本|文案/.test(`${task.title} ${userGoal}`)
    ) {
      lines.push(
        '为多个片段加字幕：一次 apply_caption_template。entries[{block_id,text}]；layout=horizontal|vertical；position=bottom_center|top_right|center 等九宫格；禁止坐标/字号/start_sec。'
      )
    }
  }
  return [{ role: 'user', content: lines.join('\n') }]
}

export function summarizeExecutedWrites(toolCalls: AgentToolCall[] | undefined): string {
  if (!toolCalls?.length) return ''
  return toolCalls.map((call) => call.name).join(', ')
}
