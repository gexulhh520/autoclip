import { describe, expect, it } from 'vitest'
import { maskStaleToolObservations } from './maskAgentToolMessages'
import type { AgentChatMessage } from '../../types/editorAgent'

describe('maskAgentToolMessages', () => {
  it('masks older tool rounds but keeps the latest round', () => {
    const longPayload = JSON.stringify({ ok: true, data: { clips: [{ id: '1', title: 'x'.repeat(500) }] } })
    const messages: AgentChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '' },
      { role: 'tool', tool_name: 'list_assets', content: longPayload },
      { role: 'assistant', content: '' },
      { role: 'tool', tool_name: 'get_overlay_detail', content: JSON.stringify({ ok: true, data: { id: 'o1' } }) },
    ]

    const { messages: masked, stats } = maskStaleToolObservations(messages, 1)
    expect(stats.masked_tool_count).toBe(1)
    expect(stats.tool_round_count).toBe(2)
    expect(masked[2]?.content).toContain('"masked":true')
    expect(masked[4]?.content).toContain('"id":"o1"')
    expect(stats.tool_messages_chars).toBeLessThan(longPayload.length + 200)
  })

  it('summarizes find_block_moments when masked', () => {
    const payload = JSON.stringify({
      ok: true,
      data: {
        block_title: 'input',
        search_criteria: '金句',
        matches: [{ timeline_start_sec: 1, timeline_end_sec: 2 }],
      },
    })
    const messages: AgentChatMessage[] = [
      { role: 'assistant', content: '' },
      { role: 'tool', tool_name: 'find_block_moments', content: payload },
    ]
    const { messages: masked } = maskStaleToolObservations(messages, 0)
    expect(masked[1]?.content).toContain('1 matches')
    expect(masked[1]?.content).toContain('find_block_moments')
  })

  it('does not mask when only one tool round exists', () => {
    const messages: AgentChatMessage[] = [
      { role: 'tool', tool_name: 'list_assets', content: '{"ok":true,"data":{"clip_count":1}}' },
    ]
    const { stats } = maskStaleToolObservations(messages, 1)
    expect(stats.masked_tool_count).toBe(0)
  })
})
