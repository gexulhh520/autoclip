import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import {
  parseClipIds,
  resolveDefaultMainTrackAppendIndex,
  resolveMainTrackBlockIndex,
  resolveSequenceInsertIndexForMainTrack,
  validateMainTrackReorder,
  validateTransition,
} from './narrativeTools'

const baseBlock = (id: string, overrides: Partial<EditBlock> = {}): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: 5 },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: 5,
  ...overrides,
})

function makeSession(sequence: EditBlock[]): EditSession {
  return {
    id: 's1',
    name: 'test',
    sequence,
    export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
    audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
  } as EditSession
}

describe('narrativeTools', () => {
  it('parseClipIds filters empty values', () => {
    expect(parseClipIds(['a', '', '  ', 'b'])).toEqual(['a', 'b'])
    expect(parseClipIds(null)).toEqual([])
  })

  it('maps main track insert index to sequence index', () => {
    const session = makeSession([
      baseBlock('main-1'),
      baseBlock('overlay-1', { track_id: 'overlay-track' }),
      baseBlock('main-2'),
    ])

    expect(resolveSequenceInsertIndexForMainTrack(session, 0)).toBe(0)
    expect(resolveSequenceInsertIndexForMainTrack(session, 1)).toBe(2)
    expect(resolveSequenceInsertIndexForMainTrack(session, 2)).toBe(3)
    expect(resolveDefaultMainTrackAppendIndex(session)).toBe(2)
  })

  it('validates transition enum', () => {
    expect(validateTransition('dissolve')).toBe('dissolve')
    expect(validateTransition('invalid')).toBeNull()
  })

  it('validates main track reorder', () => {
    const session = makeSession([baseBlock('b1'), baseBlock('b2')])

    expect(resolveMainTrackBlockIndex(session, 'b2')).toBe(1)
    expect(validateMainTrackReorder(session, 'b2', 0)).toEqual({ fromIndex: 1, toIndex: 0 })
    expect(validateMainTrackReorder(session, 'missing', 0)).toEqual({
      error: '主轨片段不存在: missing',
    })
    expect(validateMainTrackReorder(session, 'b1', 9)).toEqual({ error: 'to_index 越界: 9' })
  })
})
