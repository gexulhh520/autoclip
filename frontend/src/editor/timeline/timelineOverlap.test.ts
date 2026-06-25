import { describe, expect, it } from 'vitest'
import type { EditSession } from '../types/editSession'
import { DEFAULT_AUDIO_TRACK_ID } from '../audioTracks'
import {
  canPlaceAtStart,
  clampResizeLeftAvoidingOverlap,
  clampResizeRightAvoidingOverlap,
  clampStartAvoidingOverlap,
  findAudioClipPlacement,
  toTimelineRange,
} from './timelineOverlap'

describe('timelineOverlap', () => {
  const siblings = [
    toTimelineRange('a', 0, 2),
    toTimelineRange('b', 5, 2),
  ]

  it('clamps drag start to nearest non-overlapping gap', () => {
    expect(clampStartAvoidingOverlap(siblings, 1, 1.5)).toBeCloseTo(2, 3)
    expect(clampStartAvoidingOverlap(siblings, 1, 4)).toBeCloseTo(4, 3)
    expect(clampStartAvoidingOverlap(siblings, 1, 6)).toBeCloseTo(7, 3)
  })

  it('rejects placement when proposed start overlaps a sibling', () => {
    expect(canPlaceAtStart(siblings, 1, 1.5)).toBe(false)
    expect(canPlaceAtStart(siblings, 1, 4)).toBe(true)
    expect(canPlaceAtStart(siblings, 1, 6)).toBe(false)
  })

  it('prevents left resize from overlapping left neighbor', () => {
    const result = clampResizeLeftAvoidingOverlap(siblings, 5, 1.5)
    expect(result.start).toBeCloseTo(2, 3)
    expect(result.duration).toBeCloseTo(3, 3)
  })

  it('prevents right resize from overlapping right neighbor', () => {
    const end = clampResizeRightAvoidingOverlap(siblings, 2, 6)
    expect(end).toBeCloseTo(5, 3)
  })
})

describe('findAudioClipPlacement', () => {
  const session = (): EditSession => ({
    schema_version: 3,
    id: 's1',
    project_id: 'p1',
    name: 'test',
    overlay_snapshot: {},
    sequence: [],
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
    audio_tracks: [{ id: DEFAULT_AUDIO_TRACK_ID, name: 'Audio', order: 0 }],
    audio_elements: [{ id: 'c1', asset_id: 'a1', track_id: DEFAULT_AUDIO_TRACK_ID, start_sec: 0, duration_sec: 10 }],
    created_at: '',
    updated_at: '',
  })

  it('creates a new track for strict placement when all tracks overlap', () => {
    const placement = findAudioClipPlacement(session(), {
      preferredTrackId: DEFAULT_AUDIO_TRACK_ID,
      durationSec: 5,
      proposedStartSec: 2,
      strictStart: true,
    })
    expect(placement).not.toBeNull()
    expect(placement!.startSec).toBeCloseTo(2, 3)
    expect(placement!.trackId).not.toBe(DEFAULT_AUDIO_TRACK_ID)
    expect(placement!.newTrack).toMatchObject({ name: 'Audio 2', order: 1 })
  })

  it('returns null for strict overlap when allowNewTrack is false', () => {
    expect(
      findAudioClipPlacement(session(), {
        preferredTrackId: DEFAULT_AUDIO_TRACK_ID,
        durationSec: 5,
        proposedStartSec: 2,
        strictStart: true,
        allowNewTrack: false,
      })
    ).toBeNull()
  })

  it('finds gap on same track when strict is false', () => {
    const placement = findAudioClipPlacement(session(), {
      preferredTrackId: DEFAULT_AUDIO_TRACK_ID,
      durationSec: 3,
      proposedStartSec: 0,
      strictStart: false,
    })
    expect(placement?.startSec).toBeCloseTo(10, 3)
  })
})
