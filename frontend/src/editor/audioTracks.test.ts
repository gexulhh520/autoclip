import { describe, expect, it } from 'vitest'
import type { EditSession } from '../types/editSession'
import { ensureAudioModel, filterAudioAssetsByCategory, resolveAssetDurationSec, resolveAudioTracks } from './audioTracks'

const baseSession = (): EditSession => ({
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
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
      duration_sec: 4,
    },
  ],
  export_settings: {
    aspect: '9:16',
    height: 1080,
    fps: 30,
    visual_filter: 'none',
    fit_mode: 'contain',
  },
  audio_settings: {
    bgm_volume: 0.28,
    fade_in_sec: 0.3,
    fade_out_sec: 0.3,
    use_source_video: true,
    transition_duration_sec: 0.35,
  },
  created_at: '',
  updated_at: '',
})

describe('ensureAudioModel', () => {
  it('creates default audio track without auto timeline clip on import-only session', () => {
    const session = baseSession()
    session.audio_assets = [{ id: 'a1', name: 'music.m4a', path: 'edit_sessions/s1/asset_a1.m4a' }]
    ensureAudioModel(session)
    expect(resolveAudioTracks(session)).toHaveLength(1)
    expect(session.audio_elements).toHaveLength(0)
  })

  it('migrates legacy bgm_path to timeline clip', () => {
    const session = baseSession()
    session.audio_settings.bgm_path = 'edit_sessions/s1/bgm.m4a'
    ensureAudioModel(session)
    expect(session.audio_assets?.length).toBeGreaterThan(0)
    expect(session.audio_elements?.length).toBe(1)
    expect(session.audio_settings.bgm_path).toBeNull()
  })
})

describe('filterAudioAssetsByCategory', () => {
  it('splits sfx and bgm libraries', () => {
    const session = baseSession()
    session.audio_assets = [
      { id: 's1', name: 'click.wav', path: 'a.wav', category: 'sfx' },
      { id: 'b1', name: 'music.m4a', path: 'b.m4a', category: 'bgm' },
      { id: 'legacy', name: 'old.m4a', path: 'c.m4a' },
    ]
    expect(filterAudioAssetsByCategory(session, 'sfx')).toHaveLength(1)
    expect(filterAudioAssetsByCategory(session, 'bgm')).toHaveLength(2)
  })
})

describe('resolveAssetDurationSec', () => {
  it('falls back when loaded metadata duration is zero', () => {
    expect(resolveAssetDurationSec(0, undefined, 45)).toBe(45)
    expect(resolveAssetDurationSec(0, 120, 45)).toBe(120)
    expect(resolveAssetDurationSec(undefined, undefined, 30)).toBe(30)
  })
})
