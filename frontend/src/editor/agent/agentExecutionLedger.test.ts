import { describe, expect, it } from 'vitest'
import {
  buildExecutionRecords,
  buildInitialAgentMessages,
  formatToolExecutionRecord,
  pruneEphemeralToolContext,
} from './agentExecutionLedger'

describe('agentExecutionLedger', () => {
  it('records write success and drops read-only from ledger', () => {
    const records = buildExecutionRecords(
      [
        { name: 'list_assets', arguments: {} },
        { name: 'set_visual_filter', arguments: { visual_filter: 'mono_contrast' } },
      ],
      [
        { ok: true, tool_name: 'list_assets', data: { clip_count: 2 } },
        { ok: true, tool_name: 'set_visual_filter', data: { label: '高对比', visual_filter: 'mono_contrast' } },
      ]
    )
    expect(records).toHaveLength(1)
    expect(records[0]).toContain('高对比')
  })

  it('builds initial messages without chat history', () => {
    const messages = buildInitialAgentMessages(
      { role: 'user', content: '加高对比滤镜' },
      ['✓ 设置滤镜 mono_contrast → 高对比']
    )
    expect(messages).toHaveLength(2)
    expect(messages[0]?.content).toContain('近期写操作摘要')
    expect(messages[1]?.content).toBe('加高对比滤镜')
  })

  it('prunes read-only tool messages', () => {
    const pruned = pruneEphemeralToolContext([
      { role: 'user', content: 'hi' },
      { role: 'tool', tool_name: 'get_timeline_summary', content: '{}' },
      { role: 'tool', tool_name: 'set_visual_filter', content: '{}' },
    ])
    expect(pruned).toHaveLength(2)
    expect(pruned.some((msg) => msg.tool_name === 'get_timeline_summary')).toBe(false)
  })

  it('formats failure', () => {
    const line = formatToolExecutionRecord(
      { name: 'apply_caption_template', arguments: { entries: [] } },
      { ok: false, tool_name: 'apply_caption_template', error: 'entries 为空' }
    )
    expect(line).toContain('✗')
    expect(line).toContain('entries 为空')
  })
})
