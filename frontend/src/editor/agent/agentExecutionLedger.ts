import { formatToolCallSummary, isReadOnlyAgentTool } from './toolRegistry'
import type { AgentChatMessage, AgentToolCall, AgentToolResult } from '../../types/editorAgent'

/** 跨轮次只保留写操作成败摘要；读工具结果不进入下一轮 */
export function formatToolExecutionRecord(
  call: AgentToolCall,
  result: AgentToolResult
): string {
  const label = formatToolCallSummary(call.name, call.arguments)
  if (!result.ok) {
    return `✗ ${label} — ${result.error ?? '失败'}`
  }
  if (isReadOnlyAgentTool(call.name)) {
    return `✓ ${label}（只读，已丢弃明细）`
  }
  const data =
    result.data && typeof result.data === 'object'
      ? (result.data as Record<string, unknown>)
      : undefined
  if (call.name === 'set_visual_filter') {
    return `✓ ${label} → ${data?.label ?? data?.visual_filter ?? '已应用'}`
  }
  if (call.name === 'apply_caption_template' || call.name === 'add_captions_for_blocks') {
    return `✓ ${label} → 新增 ${data?.overlays_added ?? 0}，跳过 ${data?.overlays_skipped ?? 0}`
  }
  if (call.name === 'clear_block_captions' || call.name === 'clear_all_captions') {
    return `✓ ${label} → 删除 ${data?.overlays_removed ?? 0} 层`
  }
  return `✓ ${label}`
}

export function buildExecutionRecords(
  calls: AgentToolCall[],
  results: AgentToolResult[]
): string[] {
  return calls
    .map((call, index) => formatToolExecutionRecord(call, results[index]!))
    .filter((line) => !line.includes('（只读，已丢弃明细）'))
}

export function mergeExecutionLedger(existing: string[], incoming: string[], maxItems = 24): string[] {
  return [...existing, ...incoming].slice(-maxItems)
}

export function buildExecutionLedgerMessage(records: string[]): AgentChatMessage | null {
  if (records.length === 0) return null
  return {
    role: 'user',
    content: [
      '【近期写操作摘要】',
      ...records.map((line) => `- ${line}`),
      '',
      '说明：读工具结果不保留；当前时间线/滤镜/字幕等以本次 EditorSnapshot 为准。',
    ].join('\n'),
  }
}

/** 新用户请求：仅当前需求 + 写操作摘要，不带历史对话与读 tool JSON */
export function buildInitialAgentMessages(
  userMessage: AgentChatMessage,
  executionLedger?: string[]
): AgentChatMessage[] {
  const ledgerMsg = buildExecutionLedgerMessage(executionLedger ?? [])
  return ledgerMsg ? [ledgerMsg, userMessage] : [userMessage]
}

/** 同轮 loop 内：丢弃只读 tool 消息，写 tool 压成摘要行 */
export function pruneEphemeralToolContext(messages: AgentChatMessage[]): AgentChatMessage[] {
  return messages.filter((msg) => {
    if (msg.role !== 'tool') return true
    if (!msg.tool_name) return true
    return !isReadOnlyAgentTool(msg.tool_name)
  })
}
