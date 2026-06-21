import type { AgentChatMessage } from '../../types/editorAgent'

/** 保留最近几轮 tool 回传的完整内容；0 = 全部压成摘要（读工具同轮后也会丢弃） */
export const KEEP_FULL_TOOL_ROUNDS = 0

export interface ToolObservationMaskStats {
  tool_messages_chars: number
  masked_tool_count: number
  tool_round_count: number
}

function findToolRoundRanges(messages: AgentChatMessage[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let index = 0
  while (index < messages.length) {
    if (messages[index]?.role !== 'tool') {
      index += 1
      continue
    }
    const start = index
    while (index < messages.length && messages[index]?.role === 'tool') {
      index += 1
    }
    ranges.push({ start, end: index - 1 })
  }
  return ranges
}

function summarizeMaskedTool(toolName: string, content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (parsed.masked === true && typeof parsed.summary === 'string') {
      return parsed.summary
    }
    if (parsed.ok === false) {
      return `${toolName}: ${String(parsed.error ?? 'failed')}`
    }
    const data = parsed.data as Record<string, unknown> | undefined
    switch (toolName) {
      case 'list_assets':
        return `${toolName}: ${data?.clip_count ?? '?'} clips, ${data?.audio_count ?? '?'} audio`
      case 'get_timeline_summary':
        return `${toolName}: overlays=${data?.overlay_count ?? '?'} blocks=${data?.block_count ?? '?'}`
      case 'get_block_detail':
        return `${toolName}: block ${String(data?.id ?? '?')}`
      case 'get_overlay_detail':
        return `${toolName}: overlay ${String(data?.id ?? '?')}`
      case 'capture_preview_frame':
        return `${toolName}: frame @ ${String(data?.time_sec ?? '?')}s`
      case 'verify_subtitle_in_frame': {
        const verdict = data?.verdict as Record<string, unknown> | undefined
        const overflow = verdict?.overflow ?? '?'
        const summary = verdict?.summary ?? ''
        return `${toolName}: overflow=${overflow} ${String(summary).slice(0, 60)}`
      }
      case 'analyze_block_content': {
        const visual = data?.visual_analysis as Record<string, unknown> | undefined
        return `${toolName}: ${String(data?.block_title ?? data?.block_id ?? '?')} — ${String(visual?.summary ?? '').slice(0, 72)}`
      }
      case 'split_text_overlays_by_char':
        return `${toolName}: ok=${data?.succeeded ?? '?'} fail=${data?.failed ?? '?'} skip=${data?.skipped ?? '?'}`
      default:
        return `${toolName}: ok`
    }
  } catch {
    return `${toolName}: [masked]`
  }
}

export function buildMaskedToolObservation(toolName: string, content: string): string {
  return JSON.stringify({
    ok: true,
    tool_name: toolName,
    masked: true,
    summary: summarizeMaskedTool(toolName, content),
    note: '读/写 tool 明细已丢弃；请以 EditorSnapshot 与写操作摘要为准',
  })
}

export function measureToolMessagesChars(messages: AgentChatMessage[]): number {
  return messages
    .filter((msg) => msg.role === 'tool')
    .reduce((total, msg) => total + (msg.content?.length ?? 0), 0)
}

/** Observation masking：只保留最近 N 轮 tool 消息的完整 JSON */
export function maskStaleToolObservations(
  messages: AgentChatMessage[],
  keepLastRounds = KEEP_FULL_TOOL_ROUNDS
): { messages: AgentChatMessage[]; stats: ToolObservationMaskStats } {
  const ranges = findToolRoundRanges(messages)
  const maskRanges = ranges.slice(0, Math.max(0, ranges.length - keepLastRounds))
  if (maskRanges.length === 0) {
    return {
      messages,
      stats: {
        tool_messages_chars: measureToolMessagesChars(messages),
        masked_tool_count: 0,
        tool_round_count: ranges.length,
      },
    }
  }

  const maskIndices = new Set<number>()
  for (const range of maskRanges) {
    for (let i = range.start; i <= range.end; i += 1) {
      maskIndices.add(i)
    }
  }

  let maskedCount = 0
  const next = messages.map((msg, index) => {
    if (!maskIndices.has(index) || msg.role !== 'tool') return msg
    maskedCount += 1
    const toolName = msg.tool_name ?? 'tool'
    return {
      ...msg,
      content: buildMaskedToolObservation(toolName, msg.content),
    }
  })

  return {
    messages: next,
    stats: {
      tool_messages_chars: measureToolMessagesChars(next),
      masked_tool_count: maskedCount,
      tool_round_count: ranges.length,
    },
  }
}
