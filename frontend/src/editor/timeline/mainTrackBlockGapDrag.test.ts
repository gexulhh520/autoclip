import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { blockTimelineVisualStartSec } from '../../utils/editTimeline'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import {
  applyMainTrackBlockVisualShift,
  captureMainTrackGapBaseline,
  setMainTrackBlockVisualStart,
} from './mainTrackBlockGapDrag'
import { mainTrackSegmentSeparationSec } from './sequenceBlockGaps'

const block = (id: string, durationSec: number): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: durationSec },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: durationSec,
})

const sessionWith = (blocks: EditBlock[], gaps: number[] = []): EditSession =>
  ({
    schema_version: 3,
    id: 's1',
    project_id: 'p1',
    name: 'test',
    overlay_snapshot: {},
    sequence: blocks,
    sequence_block_gaps: gaps,
    export_settings: {
      aspect: '16:9',
      height: 1080,
      fps: 30,
      visual_filter: 'none',
      fit_mode: 'contain',
    },
    audio_settings: {
      bgm_volume: 0.3,
      fade_in_sec: 0.3,
      fade_out_sec: 0.3,
      use_source_video: true,
      transition_duration_sec: 0.35,
    },
    created_at: '',
    updated_at: '',
  }) as EditSession

describe('mainTrackBlockGapDrag', () => {
  it('transfers gap between neighbors when ripple is off', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)], [0, 1])
    applyMainTrackBlockVisualShift(session, 'b', 1, { ripple: false })

    expect(session.sequence_block_gaps![0]).toBeCloseTo(1, 3)
    expect(session.sequence_block_gaps![1]).toBeCloseTo(0, 3)
    expect(mainTrackSegmentSeparationSec(session, 0)).toBeCloseTo(1, 3)
  })

  it('opens trailing gap under ripple mode', () => {
    const session = sessionWith([block('a', 5), block('b', 5)], [0])
    applyMainTrackBlockVisualShift(session, 'b', 1.5, { ripple: true })

    expect(session.sequence_block_gaps![0]).toBeCloseTo(1.5, 3)
    const timeline = buildCompositionTimeline(session.sequence, 0.35, session.sequence_block_gaps)
    const startB = blockTimelineVisualStartSec(
      timeline.segments[1]!.compositionStartSec,
      timeline.segments[1]!.block
    )
    expect(startB).toBeCloseTo(6.5, 3)
  })

  it('opens gap between adjacent clips when dragging right with zero gaps', () => {
    const session = sessionWith([block('a', 5), block('b', 5)], [0])
    expect(applyMainTrackBlockVisualShift(session, 'b', 1, { ripple: false })).toBe(true)
    expect(session.sequence_block_gaps![0]).toBeCloseTo(1, 3)
  })

  it('setMainTrackBlockVisualStart restores baseline before applying target', () => {
    const session = sessionWith([block('a', 5), block('b', 5)], [0])
    const baseline = captureMainTrackGapBaseline(session)
    applyMainTrackBlockVisualShift(session, 'b', 1, { ripple: false })
    expect(session.sequence_block_gaps![0]).toBeCloseTo(1, 3)

    setMainTrackBlockVisualStart(session, 'b', 5.5, baseline, { ripple: false })
    expect(session.sequence_block_gaps![0]).toBeCloseTo(0.5, 3)
  })

  it('setMainTrackBlockVisualStart lands on exact target when trailing gap allows', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)], [0, 2])
    const baseline = captureMainTrackGapBaseline(session)
    setMainTrackBlockVisualStart(session, 'b', 6.2, baseline, { ripple: false })

    const timeline = buildCompositionTimeline(session.sequence, 0.35, session.sequence_block_gaps)
    const startB = blockTimelineVisualStartSec(
      timeline.segments[1]!.compositionStartSec,
      timeline.segments[1]!.block
    )
    expect(startB).toBeCloseTo(6.2, 3)
    expect(session.sequence_block_gaps![0]).toBeCloseTo(1.2, 3)
    expect(session.sequence_block_gaps![1]).toBeCloseTo(0.8, 3)
  })
})
