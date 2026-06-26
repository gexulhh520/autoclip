import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../types/editSession'
import {
  DEFAULT_VIDEO_TRACK_ID,
  buildVideoTrackMutedMap,
  ensureVideoTracks,
  getBlockTrackId,
  isMainTrackBlock,
  resolveMainTrackBlocks,
  resolveMainTrackFreePositionBlocks,
  resolveMainTrackSequentialBlocks,
  resolveOverlayVideoBlocks,
  resolveVideoTracks,
  reorderVideoTrackMetas,
  mapOverlayBlockToRelativeSource,
} from './videoTracks'

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

const baseSession = (blocks: EditBlock[]): EditSession => ({
  schema_version: 3,
  id: 's1',
  project_id: 'p1',
  name: 'test',
  overlay_snapshot: {},
  sequence: blocks,
  export_settings: {
    aspect: '9:16',
    height: 1920,
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

describe('ensureVideoTracks', () => {
  it('migrates legacy sessions without video_tracks', () => {
    const session = baseSession([baseBlock('b1')])
    expect(ensureVideoTracks(session)).toBe(true)
    expect(session.video_tracks).toHaveLength(1)
    expect(session.video_tracks?.[0]?.id).toBe(DEFAULT_VIDEO_TRACK_ID)
    expect(getBlockTrackId(session.sequence[0]!)).toBe(DEFAULT_VIDEO_TRACK_ID)
  })

  it('buildVideoTrackMutedMap reflects session video_tracks.muted', () => {
    const session = baseSession([baseBlock('b1')])
    ensureVideoTracks(session)
    session.video_tracks = [
      { id: DEFAULT_VIDEO_TRACK_ID, name: 'Video', order: 0, muted: true },
      { id: 'overlay-track', name: 'Video 2', order: 1, muted: false },
    ]
    expect(buildVideoTrackMutedMap(session)).toEqual({
      [DEFAULT_VIDEO_TRACK_ID]: true,
    })
  })

  it('preserves timeline_start_sec on main track free-position blocks', () => {
    const session = baseSession([
      baseBlock('free-main', {
        track_id: DEFAULT_VIDEO_TRACK_ID,
        timeline_start_sec: 12,
      }),
    ])
    ensureVideoTracks(session)
    expect(session.sequence[0]?.timeline_start_sec).toBe(12)
  })

  it('assigns timeline_start_sec to overlay blocks', () => {
    const session = baseSession([
      baseBlock('main', { track_id: DEFAULT_VIDEO_TRACK_ID }),
      baseBlock('overlay', {
        track_id: 'overlay-track',
        timeline_start_sec: 2,
      }),
    ])
    session.video_tracks = [
      { id: DEFAULT_VIDEO_TRACK_ID, name: 'Video', order: 0 },
      { id: 'overlay-track', name: 'Video 2', order: 1 },
    ]
    ensureVideoTracks(session)
    expect(resolveMainTrackBlocks(session)).toHaveLength(1)
    expect(resolveOverlayVideoBlocks(session)).toHaveLength(1)
    expect(isMainTrackBlock(session.sequence[0]!)).toBe(true)
    expect(isMainTrackBlock(session.sequence[1]!)).toBe(false)
  })

  it('maps overlay composition time to trim-relative source time', () => {
    const block = baseBlock('overlay', {
      track_id: 'overlay-track',
      timeline_start_sec: 2,
      trim: { in_sec: 1, out_sec: 9 },
      playback_rate: 2,
    })
    expect(mapOverlayBlockToRelativeSource(block, 2)).toBe(0)
    expect(mapOverlayBlockToRelativeSource(block, 3)).toBeCloseTo(2, 5)
    expect(mapOverlayBlockToRelativeSource(block, 10)).toBe(8)
  })
})

describe('resolveVideoTracks', () => {
  it('sorts tracks by order', () => {
    const session = baseSession([])
    session.video_tracks = [
      { id: 'b', name: 'B', order: 2 },
      { id: 'a', name: 'A', order: 1 },
      { id: DEFAULT_VIDEO_TRACK_ID, name: 'Video', order: 0 },
    ]
    const sorted = resolveVideoTracks(session)
    expect(sorted.map((track) => track.id)).toEqual([
      DEFAULT_VIDEO_TRACK_ID,
      'a',
      'b',
    ])
  })
})

describe('reorderVideoTrackMetas', () => {
  it('moves a track and reindexes order', () => {
    const tracks = [
      { id: DEFAULT_VIDEO_TRACK_ID, name: 'Video', order: 0 },
      { id: 'overlay-track', name: 'Video 2', order: 1 },
      { id: 'overlay-3', name: 'Video 3', order: 2 },
    ]
    const next = reorderVideoTrackMetas(tracks, 2, 0)
    expect(next.map((track) => track.id)).toEqual([
      'overlay-3',
      DEFAULT_VIDEO_TRACK_ID,
      'overlay-track',
    ])
    expect(next.map((track) => track.order)).toEqual([0, 1, 2])
  })
})
