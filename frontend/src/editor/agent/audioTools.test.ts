import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  buildUpdateBlockAudioPatch,
  hasAudioPatchFields,
  resolveBlockLinkOffset,
  validateAudioAssetId,
  validateVideoBlockId,
} from './audioTools'

function makeSession(): EditSession {
  return {
    id: 's1',
    name: 'test',
    sequence: [
      {
        id: 'b1',
        source_clip_id: 'c1',
        title: 'block',
        media: { type: 'step6_clip', path: 'a.mp4' },
        trim: { in_sec: 0, out_sec: 10 },
        overlay: { outline: '', content: [], recommend_reason: '' },
        audio: { volume: 1 },
        transition_out: 'cut',
        duration_sec: 10,
      },
    ],
    export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
    audio_settings: {
      use_source_video: true,
      bgm_volume: 0.28,
      fade_in_sec: 0.3,
      fade_out_sec: 0.3,
      transition_duration_sec: 0.35,
    },
    audio_assets: [{ id: 'bgm-1', name: 'music.m4a', path: 'm.m4a', category: 'bgm' }],
  } as EditSession
}

describe('audioTools', () => {
  it('validates asset and block ids', () => {
    const session = makeSession()
    expect(validateAudioAssetId(session, 'bgm-1')).toEqual({ ok: true })
    expect(validateAudioAssetId(session, 'missing').error).toContain('不存在')
    expect(validateVideoBlockId(session, 'b1')).toEqual({ ok: true })
    expect(validateVideoBlockId(session, 'x').error).toContain('不存在')
  })

  it('builds block link offset from composition start', () => {
    const session = makeSession()
    const link = resolveBlockLinkOffset(session, 'b1', 2.5)
    expect(link).toEqual({ block_id: 'b1', block_offset_sec: 2.5 })
  })

  it('builds update block audio patch with clamps', () => {
    const patch = buildUpdateBlockAudioPatch({ volume: 3, fade_in_sec: -1, fade_out_sec: 0.5 })
    expect(patch.volume).toBe(2)
    expect(patch.fade_in_sec).toBe(0)
    expect(patch.fade_out_sec).toBe(0.5)
    expect(hasAudioPatchFields(patch)).toBe(true)
    expect(hasAudioPatchFields({})).toBe(false)
  })
})
