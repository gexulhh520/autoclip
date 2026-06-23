import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  hasEditSessionPreviewContent,
  resolveEditSessionTimelineDurationSec,
} from './sessionTimelineDuration'

const baseSession = (): EditSession =>
  ({
    id: 's1',
    project_id: 'p1',
    sequence: [],
    overlay_elements: [],
    audio_elements: [],
    audio_assets: [],
    audio_tracks: [],
    audio_settings: { transition_duration_sec: 0.35 },
    export_settings: { aspect: '9:16', height: 1080, fps: 30, visual_filter: 'none', fit_mode: 'contain' },
  }) as EditSession

describe('resolveEditSessionTimelineDurationSec', () => {
  it('uses audio clip end when there is no video', () => {
    const session = baseSession()
    session.audio_elements = [
      {
        id: 'clip-1',
        asset_id: 'asset-1',
        track_id: 'default-audio',
        start_sec: 2,
        duration_sec: 8,
      },
    ]
    expect(resolveEditSessionTimelineDurationSec(session)).toBe(10)
  })

  it('uses text overlay end when there is no video', () => {
    const session = baseSession()
    session.overlay_elements = [
      {
        id: 'text-1',
        start_sec: 1,
        duration_sec: 5,
        params: { content: 'hello' },
      },
    ]
    expect(resolveEditSessionTimelineDurationSec(session)).toBe(6)
  })
})

describe('hasEditSessionPreviewContent', () => {
  it('returns true for audio-only timeline', () => {
    const session = baseSession()
    session.audio_assets = [{ id: 'asset-1', name: 'voice.mp3', path: 'voice.mp3', category: 'sfx' }]
    session.audio_elements = [
      {
        id: 'clip-1',
        asset_id: 'asset-1',
        track_id: 'default-audio',
        start_sec: 0,
        duration_sec: 4,
      },
    ]
    expect(hasEditSessionPreviewContent(session)).toBe(true)
  })

  it('returns false for empty timeline', () => {
    expect(hasEditSessionPreviewContent(baseSession())).toBe(false)
  })
})
