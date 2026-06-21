import { describe, expect, it } from 'vitest'
import { writeParam } from '../opencut-text/params'
import { TIMELINE_BLOCK_ID_PARAM, TIMELINE_BLOCK_OFFSET_PARAM } from '../timeline/timelineBlockLink'
import { executeClearAllCaptions, executeClearBlockCaptions } from './clearCaptions'

const baseSession = () =>
  ({
    schema_version: 3,
    id: 's1',
    project_id: 'p1',
    name: 'test',
    overlay_snapshot: {},
    sequence: [
      {
        id: 'b1',
        source_clip_id: 'b1',
        title: 'A',
        media: { type: 'step6_clip', path: 'a.mp4' },
        trim: { in_sec: 0, out_sec: 4 },
        overlay: { outline: 'draft', content: ['春风'], recommend_reason: '' },
        audio: { volume: 1 },
        transition_out: 'cut',
        duration_sec: 4,
      },
      {
        id: 'b2',
        source_clip_id: 'b2',
        title: 'B',
        media: { type: 'step6_clip', path: 'b.mp4' },
        trim: { in_sec: 0, out_sec: 4 },
        overlay: { outline: '', content: [], recommend_reason: '' },
        audio: { volume: 1 },
        transition_out: 'cut',
        duration_sec: 4,
      },
    ],
    export_settings: {
      aspect: '9:16',
      height: 1920,
      fps: 30,
      visual_filter: 'none',
      fit_mode: 'contain',
    },
    overlay_elements: [
      {
        id: 't1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 4,
        params: writeParam(
          writeParam({ content: '春风' }, TIMELINE_BLOCK_ID_PARAM, 'b1'),
          TIMELINE_BLOCK_OFFSET_PARAM,
          0
        ),
      },
      {
        id: 't2',
        type: 'text',
        hidden: false,
        start_sec: 4,
        duration_sec: 4,
        params: writeParam(
          writeParam({ content: '夏雨' }, TIMELINE_BLOCK_ID_PARAM, 'b2'),
          TIMELINE_BLOCK_OFFSET_PARAM,
          0
        ),
      },
    ],
    created_at: '',
    updated_at: '',
  }) as import('../../types/editSession').EditSession

function mockStore(session: import('../../types/editSession').EditSession) {
  return {
    session,
    sequencePlayheadSec: 0,
    selectedBlockId: null,
    selectedOverlayId: null,
    removeOverlayElements: (ids: string[]) => {
      const idSet = new Set(ids)
      session.overlay_elements = (session.overlay_elements ?? []).filter((el) => !idSet.has(el.id))
    },
  }
}

describe('clearCaptions', () => {
  it('clears captions for one block only', () => {
    const session = baseSession()
    const getStore = () => mockStore(session) as ReturnType<
      typeof import('../../stores/useEditSessionStore').useEditSessionStore.getState
    >
    const result = executeClearBlockCaptions(getStore, ['b1'], { recordHistory: false })
    expect(result.overlays_removed).toBe(1)
    expect(session.overlay_elements?.map((el) => el.id)).toEqual(['t2'])
    expect(session.sequence[0].overlay?.content).toEqual([])
    expect(session.sequence[0].overlay?.caption_suppressed).toBe(true)
  })

  it('clears all main-track captions', () => {
    const session = baseSession()
    const getStore = () => mockStore(session) as ReturnType<
      typeof import('../../stores/useEditSessionStore').useEditSessionStore.getState
    >
    const result = executeClearAllCaptions(getStore, { recordHistory: false })
    expect(result.overlays_removed).toBe(2)
    expect(session.overlay_elements).toEqual([])
  })
})
