import { describe, expect, it } from 'vitest'
import {
  AUTO_HIGH_RECALL_MIN_DURATION_SEC,
  isVisualMomentSearchCriteria,
  resolveMomentRecallMode,
} from './momentRecallMode'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { EditSession } from '../../types/editSession'

function makeSession(durationSec: number, blockId = 'b1'): EditSession {
  return {
    id: 's1',
    project_id: 'p1',
    sequence: [
      {
        id: blockId,
        title: '测试片段',
        media: { type: 'clip', path: 'v.mp4' },
        trim: { in_sec: 0, out_sec: durationSec },
        overlay: { outline: '', content: [], recommend_reason: '' },
        audio: { volume: 1, fade_in_sec: 0, fade_out_sec: 0 },
      },
    ],
  } as EditSession
}

describe('momentRecallMode', () => {
  it('detects visual moment criteria', () => {
    expect(isVisualMomentSearchCriteria('找到所有枪战片段')).toBe(true)
    expect(isVisualMomentSearchCriteria('富有哲学的话')).toBe(false)
  })

  it('respects explicit recall_mode in args', () => {
    const session = makeSession(120)
    expect(
      resolveMomentRecallMode({
        sessionId: 's1',
        session,
        blockId: 'b1',
        args: { recall_mode: 'high' },
        searchCriteria: '打斗',
      })
    ).toBe('high')
  })

  it('uses UI toggle when enabled', () => {
    useAgentPanelStore.getState().setHighRecallSearchEnabled(true)
    const session = makeSession(60)
    expect(
      resolveMomentRecallMode({
        sessionId: 's1',
        session,
        blockId: 'b1',
        searchCriteria: '打斗',
      })
    ).toBe('high')
    useAgentPanelStore.getState().setHighRecallSearchEnabled(false)
  })

  it('auto high for long visual search', () => {
    const session = makeSession(AUTO_HIGH_RECALL_MIN_DURATION_SEC + 10)
    expect(
      resolveMomentRecallMode({
        sessionId: 's1',
        session,
        blockId: 'b1',
        searchCriteria: '找枪战',
      })
    ).toBe('high')
  })

  it('stays balanced for short non-visual search', () => {
    useAgentPanelStore.getState().setHighRecallSearchEnabled(false)
    const session = makeSession(60)
    expect(
      resolveMomentRecallMode({
        sessionId: 's1',
        session,
        blockId: 'b1',
        searchCriteria: '金句',
      })
    ).toBe('balanced')
  })
})
