import type { AgentDebugTrace } from '../../types/editorAgent'

export function formatAgentDebugSummary(trace: AgentDebugTrace): string {
  const last = trace.rounds[trace.rounds.length - 1]
  const est = last?.debug?.estimated_prompt_tokens
  const suggestedCtx = last?.debug?.suggested_num_ctx
  const promptTokens = last?.usage?.prompt_tokens
  const finish = last?.finish_reason

  const head = [
    `${trace.total_rounds} 轮`,
    trace.outcome,
    est != null ? `估 ${est} tok` : null,
    promptTokens != null ? `实 ${promptTokens} tok` : null,
    suggestedCtx != null ? `建议 ctx ${suggestedCtx}` : null,
    finish ? `finish=${finish}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const rounds = trace.rounds
    .map((round) => {
      const read = round.read_tools.join(',') || '—'
      const write = round.write_tools.join(',') || '—'
      return `R${round.round} 读:${read} 写:${write}`
    })
    .join(' | ')

  return `${head}\n${rounds}`
}

export function formatAgentDebugDetail(trace: AgentDebugTrace): string {
  const last = trace.rounds[trace.rounds.length - 1]?.debug
  if (!last) return formatAgentDebugSummary(trace)

  return [
    formatAgentDebugSummary(trace),
    `messages ${last.message_count} · snapshot ${last.snapshot_chars} 字 · layout ${last.layout_reference_chars} 字 · tools schema ${last.tool_schema_chars} 字`,
  ].join('\n')
}
