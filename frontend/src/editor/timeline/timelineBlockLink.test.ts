import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import { writeParam } from '../opencut-text/params'
import {
  applyTailTrimLinkedElements,
  attachAudioClipBlockLink,
  attachOverlayBlockLink,
  findSegmentAtCompositionTime,
  reconcileTimelineBlockLinks,
  segmentVisualEndSec,
  TIMELINE_BLOCK_ID_PARAM,
  TIMELINE_BLOCK_OFFSET_PARAM,
} from './timelineBlockLink'

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
    transition_duration_sec: 0.7,
  },
  overlay_elements: [
    {
      id: 'text-1',
      type: 'text',
      start_sec: 4.5,
      duration_sec: 2,
      hidden: false,
      params: writeParam(
        writeParam({}, TIMELINE_BLOCK_ID_PARAM, 'b2'),
        TIMELINE_BLOCK_OFFSET_PARAM,
        0.5
      ),
    },
  ],
  audio_elements: [
    {
      id: 'sfx-1',
      asset_id: 'asset-sfx',
      start_sec: 4.5,
      duration_sec: 1,
      block_id: 'b2',
      block_offset_sec: 0.5,
    },
  ],
  audio_assets: [{ id: 'asset-sfx', name: 'click.wav', path: 'a.wav', category: 'sfx' }],
  created_at: '',
  updated_at: '',
})

describe('reconcileTimelineBlockLinks', () => {
  it('does not shift linked text and sfx when earlier block gets a cross transition', () => {
    const session = baseSession()
    session.sequence[0].transition_out = 'fade_black'
    expect(reconcileTimelineBlockLinks(session)).toBe(false)
    expect(session.overlay_elements![0].start_sec).toBeCloseTo(4.5, 2)
    expect(session.audio_elements![0].start_sec).toBeCloseTo(4.5, 2)
  })

  it('shifts linked text and sfx when block in point advances', () => {
    const session = baseSession()
    session.sequence = [session.sequence[0]]
    session.overlay_elements = [
      {
        id: 'text-1',
        type: 'text',
        start_sec: 0.5,
        duration_sec: 1,
        hidden: false,
        params: writeParam(
          writeParam({}, TIMELINE_BLOCK_ID_PARAM, 'b1'),
          TIMELINE_BLOCK_OFFSET_PARAM,
          0.5
        ),
      },
    ]
    session.audio_elements = [
      {
        id: 'sfx-1',
        asset_id: 'asset-sfx',
        start_sec: 0.5,
        duration_sec: 0.3,
        block_id: 'b1',
        block_offset_sec: 0.5,
      },
    ]
    session.sequence[0].trim.in_sec = 2
    expect(reconcileTimelineBlockLinks(session)).toBe(true)
    expect(session.overlay_elements![0].start_sec).toBeCloseTo(2.5, 2)
    expect(session.audio_elements![0].start_sec).toBeCloseTo(2.5, 2)
  })
})

describe('attachOverlayBlockLink', () => {
  it('stores block offset from visible clip start', () => {
    const session = baseSession()
    const element = {
      id: 't2',
      type: 'text' as const,
      start_sec: 5,
      duration_sec: 1,
      hidden: false,
      params: {},
    }
    attachOverlayBlockLink(session, element)
    expect(element.params[TIMELINE_BLOCK_ID_PARAM]).toBe('b2')
    expect(element.params[TIMELINE_BLOCK_OFFSET_PARAM]).toBeCloseTo(1, 3)
  })
})

describe('attachAudioClipBlockLink', () => {
  it('stores block link on sfx clip', () => {
    const session = baseSession()
    const clip = {
      id: 'c1',
      asset_id: 'asset-sfx',
      start_sec: 1.2,
      duration_sec: 0.5,
    }
    attachAudioClipBlockLink(session, clip)
    expect(clip.block_id).toBe('b1')
    expect(clip.block_offset_sec).toBeCloseTo(1.2, 3)
  })
})

describe('applyTailTrimLinkedElements', () => {
  it('shortens text and sfx when video tail is trimmed inside their range', () => {
    const session = baseSession()
    session.sequence = [session.sequence[0]]
    session.overlay_elements = [
      {
        id: 'text-1',
        type: 'text',
        start_sec: 2,
        duration_sec: 2,
        hidden: false,
        params: {},
      },
    ]
    session.audio_elements = [
      {
        id: 'sfx-1',
        asset_id: 'asset-sfx',
        start_sec: 2.5,
        duration_sec: 1.5,
      },
    ]

    const segment = findSegmentAtCompositionTime(session, 2)!
    const oldEnd = segmentVisualEndSec(segment)
    const newEnd = oldEnd - 1

    expect(
      applyTailTrimLinkedElements(session, 'b1', oldEnd, newEnd)
    ).toBe(true)
    expect(session.overlay_elements![0].duration_sec).toBeCloseTo(1, 3)
    expect(session.audio_elements![0].duration_sec).toBeCloseTo(0.5, 3)
  })

  it('does not restore duration when video tail is extended again', () => {
    const session = baseSession()
    session.sequence = [session.sequence[0]]
    session.overlay_elements = [
      {
        id: 'text-1',
        type: 'text',
        start_sec: 1,
        duration_sec: 1,
        hidden: false,
        params: {},
      },
    ]

    const segment = findSegmentAtCompositionTime(session, 1)!
    const fullEnd = segmentVisualEndSec(segment)
    applyTailTrimLinkedElements(session, 'b1', fullEnd, fullEnd - 1)
    expect(session.overlay_elements![0].duration_sec).toBeCloseTo(1, 3)

    applyTailTrimLinkedElements(session, 'b1', fullEnd - 1, fullEnd)
    expect(session.overlay_elements![0].duration_sec).toBeCloseTo(1, 3)
  })

  it('assigns ownership by element start position, not stale block_id', () => {
    const session = baseSession()
    session.sequence = [session.sequence[0]]
    session.overlay_elements = [
      {
        id: 'text-1',
        type: 'text',
        start_sec: 2,
        duration_sec: 2,
        hidden: false,
        params: writeParam(
          writeParam({}, TIMELINE_BLOCK_ID_PARAM, 'b2'),
          TIMELINE_BLOCK_OFFSET_PARAM,
          0
        ),
      },
    ]

    const b1Segment = findSegmentAtCompositionTime(session, 2)!
    const oldEnd = segmentVisualEndSec(b1Segment)
    const newEnd = oldEnd - 0.5

    expect(
      applyTailTrimLinkedElements(session, 'b1', oldEnd, newEnd)
    ).toBe(true)
    expect(session.overlay_elements![0].duration_sec).toBeCloseTo(1.5, 3)

    expect(
      applyTailTrimLinkedElements(session, 'b2', oldEnd, newEnd)
    ).toBe(false)
  })
})
