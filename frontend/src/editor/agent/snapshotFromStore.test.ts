import { describe, expect, it, beforeEach } from 'vitest'
import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import type { EditSession } from '../../types/editSession'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'

function makeStore(session: EditSession | null) {
  return () => ({
    session,
    sequencePlayheadSec: 0,
    selectedBlockId: null,
    selectedOverlayId: null,
  })
}

describe('buildEditorSnapshotFromStore', () => {
  beforeEach(() => {
    useAgentPanelStore.setState({ focusedBlockBySession: {}, focusRequest: null })
  })

  it('builds snapshot when session exists', () => {
    const session = {
      id: 's1',
      name: 'test',
      sequence: [],
      export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
      audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
    } as EditSession

    const snapshot = buildEditorSnapshotFromStore(makeStore(session) as never)
    expect(snapshot.session_id).toBe('s1')
    expect(snapshot.focused_block_id).toBeNull()
  })

  it('includes focused block pinned from AI panel', () => {
    const session = {
      id: 's1',
      name: 'test',
      sequence: [
        {
          id: 'b1',
          title: '长视频',
          trim: { in_sec: 0, out_sec: 120 },
          playback_rate: 1,
        },
      ],
      export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
      audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
    } as EditSession

    useAgentPanelStore.getState().focusBlock('s1', 'b1')
    const snapshot = buildEditorSnapshotFromStore(makeStore(session) as never)
    expect(snapshot.focused_block_id).toBe('b1')
    expect(snapshot.focused_block?.title).toBe('长视频')
    expect(snapshot.focused_block?.duration_sec).toBe(120)
  })

  it('throws when session missing', () => {
    expect(() => buildEditorSnapshotFromStore(makeStore(null) as never)).toThrow('无活动剪辑工程')
  })
})
