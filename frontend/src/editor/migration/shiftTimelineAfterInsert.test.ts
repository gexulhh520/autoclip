import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { buildCompositionTimelineSegments } from '../scene/timelineLayout'
import { ensureTemplateCaptionOverlays } from './templateCaptionOverlays'
import { shiftTimelineElementsAfterVideoInsert } from './shiftTimelineAfterInsert'

const block = (id: string, duration: number): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: {
    outline: 'headline',
    content: ['headline'],
    recommend_reason: '',
  },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: duration,
})

const session = (sequence: EditBlock[]): EditSession => ({
  schema_version: 3,
  id: 's1',
  project_id: 'p1',
  name: 'test',
  overlay_snapshot: {},
  sequence,
  overlay_elements: [
    {
      id: 'free-1',
      type: 'text',
      start_sec: 4,
      duration_sec: 2,
      params: { content: '自由文本' },
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
    use_source_video: false,
    transition_duration_sec: 0.35,
  },
  created_at: '',
  updated_at: '',
})

describe('shiftTimelineElementsAfterVideoInsert', () => {
  it('does not shift text or audio when first main-track video is imported', () => {
    const editSession = session([])
    editSession.sequence = []
    editSession.audio_elements = [
      {
        id: 'audio-1',
        asset_id: 'asset-1',
        start_sec: 2,
        duration_sec: 6,
      },
    ]
    editSession.overlay_elements![0]!.start_sec = 5

    const inserted = block('v1', 10)
    editSession.sequence.splice(0, 0, inserted)

    expect(shiftTimelineElementsAfterVideoInsert(editSession, 0, 1, { linkEnabled: true })).toBe(false)
    expect(editSession.overlay_elements?.[0]?.start_sec).toBeCloseTo(5, 3)
    expect(editSession.audio_elements?.[0]?.start_sec).toBeCloseTo(2, 3)
  })

  it('shifts free text at or after insert composition time', () => {
    const editSession = session([block('a', 4), block('b', 3)])
    const inserted = block('x', 2)
    editSession.sequence.splice(1, 0, inserted)

    expect(shiftTimelineElementsAfterVideoInsert(editSession, 1, 1, { linkEnabled: true })).toBe(true)
    expect(editSession.overlay_elements?.[0]?.start_sec).toBeCloseTo(6, 3)
  })

  it('does not shift free text before insert composition time', () => {
    const editSession = session([block('a', 4), block('b', 3)])
    editSession.overlay_elements![0]!.start_sec = 1
    const inserted = block('x', 2)
    editSession.sequence.splice(1, 0, inserted)

    expect(shiftTimelineElementsAfterVideoInsert(editSession, 1, 1, { linkEnabled: true })).toBe(false)
    expect(editSession.overlay_elements?.[0]?.start_sec).toBeCloseTo(1, 3)
  })

  it('template-linked overlays realign to block after ensureTemplateCaptionOverlays', () => {
    const editSession = session([block('a', 4), block('b', 3)])
    ensureTemplateCaptionOverlays(editSession)
    const before = editSession.overlay_elements?.find(
      (item) => String(item.params['template.blockId'] ?? '') === 'b'
    )
    expect(before?.start_sec).toBeCloseTo(4, 3)

    editSession.sequence.splice(1, 0, block('x', 2))
    shiftTimelineElementsAfterVideoInsert(editSession, 1, 1, { linkEnabled: true })
    ensureTemplateCaptionOverlays(editSession)

    const after = editSession.overlay_elements?.find(
      (item) => String(item.params['template.blockId'] ?? '') === 'b'
    )
    expect(after?.start_sec).toBeCloseTo(6, 3)

    const segments = buildCompositionTimelineSegments(editSession.sequence, 24, 0.35)
    const bSegment = segments.find((segment) => segment.block.id === 'b')
    expect(after?.start_sec).toBeCloseTo(bSegment?.startSec ?? 0, 3)
  })

  it('does not shift when appending to end of main track', () => {
    const editSession = session([block('a', 4), block('b', 3)])
    editSession.overlay_elements![0]!.start_sec = 8
    editSession.audio_elements = [
      {
        id: 'audio-1',
        asset_id: 'asset-1',
        start_sec: 9,
        duration_sec: 4,
      },
    ]
    editSession.sequence.push(block('c', 2))

    expect(
      shiftTimelineElementsAfterVideoInsert(editSession, 2, 1, { linkEnabled: true })
    ).toBe(false)
    expect(editSession.overlay_elements?.[0]?.start_sec).toBeCloseTo(8, 3)
    expect(editSession.audio_elements?.[0]?.start_sec).toBeCloseTo(9, 3)
  })

  it('does not shift when fragment link is disabled', () => {
    const editSession = session([block('a', 4), block('b', 3)])
    editSession.overlay_elements![0]!.start_sec = 6
    editSession.sequence.splice(1, 0, block('x', 2))

    expect(shiftTimelineElementsAfterVideoInsert(editSession, 1, 1, { linkEnabled: false })).toBe(
      false
    )
    expect(editSession.overlay_elements?.[0]?.start_sec).toBeCloseTo(6, 3)
  })
})
