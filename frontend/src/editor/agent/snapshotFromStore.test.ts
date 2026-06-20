import { describe, expect, it } from 'vitest'
import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import type { EditSession } from '../../types/editSession'

function makeStore(session: EditSession | null) {
  return () => ({
    session,
    sequencePlayheadSec: 0,
    selectedBlockId: null,
    selectedOverlayId: null,
  })
}

describe('buildEditorSnapshotFromStore', () => {
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
  })

  it('throws when session missing', () => {
    expect(() => buildEditorSnapshotFromStore(makeStore(null) as never)).toThrow('无活动剪辑工程')
  })
})
