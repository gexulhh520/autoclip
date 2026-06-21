import { formatToolCallSummary } from './toolRegistry'
import type { AgentTaskItem, AgentToolCall, AgentToolResult } from '../../types/editorAgent'

function readData(result: AgentToolResult): Record<string, unknown> | undefined {
  if (!result.ok || !result.data || typeof result.data !== 'object') return undefined
  return result.data as Record<string, unknown>
}

function summarizeToolResult(call: AgentToolCall, result: AgentToolResult): string {
  const label = formatToolCallSummary(call.name, call.arguments)
  if (!result.ok) {
    return `${label} → 失败: ${result.error ?? 'unknown'}`
  }

  const data = readData(result)
  switch (call.name) {
    case 'split_text_overlay_by_char': {
      const count = data?.char_count ?? data?.created_overlay_ids
      const layout = call.arguments.layout === 'vertical' ? '竖排' : '横排'
      return `${label} → ${layout} ${count ?? '?'} 字`
    }
    case 'split_text_overlays_by_char': {
      const batch = result.data as Record<string, unknown> | undefined
      return `${label} → 成功 ${batch?.succeeded ?? 0}，跳过 ${batch?.skipped ?? 0}，失败 ${batch?.failed ?? 0}`
    }
    case 'add_text_overlay':
      return `${label} → 已添加`
    case 'apply_caption_template':
    case 'add_captions_for_blocks': {
      const data = result.data as Record<string, unknown> | undefined
      return `${label} → 新增 ${data?.overlays_added ?? 0}，跳过 ${data?.overlays_skipped ?? 0}，${data?.layout ?? '?'}/${data?.position ?? '?'}`
    }
    case 'update_overlay_params':
      return `${label} → 已更新`
    case 'set_text_animation':
      return `${label} → 动画已设置`
    case 'verify_subtitle_in_frame': {
      const verdict = data?.verdict as Record<string, unknown> | undefined
      const overflow = verdict?.overflow ?? '?'
      const summary = String(verdict?.summary ?? '').slice(0, 48)
      return `验证字幕 → overflow=${overflow}${summary ? ` ${summary}` : ''}`
    }
    default:
      return `${label} → 完成`
  }
}

/** 将单任务写工具执行结果压成 1 行摘要，供后续 task 上下文使用 */
export function summarizeCompletedTask(
  task: Pick<AgentTaskItem, 'id' | 'title'>,
  toolCalls: AgentToolCall[],
  results: AgentToolResult[]
): string {
  const parts = toolCalls.map((call, index) =>
    summarizeToolResult(call, results[index] ?? { ok: false, tool_name: call.name, error: '无结果' })
  )
  const body = parts.length > 0 ? parts.join('；') : '无写操作'
  return `[${task.id}] ${task.title}: ${body}`
}
