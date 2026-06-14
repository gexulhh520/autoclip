import { describe, expect, it } from 'vitest'
import type { EditSession } from '../types/editSession'
import {
  DEFAULT_TEXT_TRACK_ID,
  ensureTextTracks,
  getOverlayTrackId,
  sortOverlaysByTrackOrder,
} from './textTracks'

const baseSession = (): EditSession => ({
  schema_version: 2,
  id: 's1',
  project_id: 'p1',
  name: 'test',
  overlay_snapshot: {},
  sequence: [],
  overlay_elements: [],
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
    use_source_video: false,
    transition_duration_sec: 0.35,
  },
  created_at: '',
  updated_at: '',
})

describe('textTracks', () => {
  it('migrates legacy sessions without text_tracks', () => {
    const session = baseSession()
    session.overlay_elements = [
      {
        id: 't1',
        type: 'text',
        start_sec: 0,
        duration_sec: 2,
        hidden: false,
        params: { content: 'hello' },
      },
    ]
    expect(ensureTextTracks(session)).toBe(true)
    expect(session.text_tracks).toHaveLength(1)
    expect(session.text_tracks?.[0]?.id).toBe(DEFAULT_TEXT_TRACK_ID)
    expect(session.overlay_elements?.[0]?.track_id).toBe(DEFAULT_TEXT_TRACK_ID)
  })

  it('sorts overlays by track order then start time', () => {
    const session = baseSession()
    session.text_tracks = [
      { id: 'track-a', name: 'A', order: 0 },
      { id: 'track-b', name: 'B', order: 1 },
    ]
    session.overlay_elements = [
      {
        id: 'b1',
        type: 'text',
        track_id: 'track-b',
        start_sec: 0,
        duration_sec: 2,
        hidden: false,
        params: { content: 'b' },
      },
      {
        id: 'a2',
        type: 'text',
        track_id: 'track-a',
        start_sec: 5,
        duration_sec: 2,
        hidden: false,
        params: { content: 'a2' },
      },
      {
        id: 'a1',
        type: 'text',
        track_id: 'track-a',
        start_sec: 1,
        duration_sec: 2,
        hidden: false,
        params: { content: 'a1' },
      },
    ]
    const sorted = sortOverlaysByTrackOrder(session.overlay_elements, session.text_tracks)
    expect(sorted.map((item) => item.id)).toEqual(['a1', 'a2', 'b1'])
    expect(getOverlayTrackId(session.overlay_elements[0])).toBe('track-b')
  })
})
