import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import {
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import {
  absorbBlockDurationDeltaWithGap,
  applyVideoHeadTrimClamp,
} from './sequenceBlockGaps'

const block = (
  id: string,
  durationSec: number,
  trim?: { in: number; out: number }
): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: {
    in_sec: trim?.in ?? 0,
    out_sec: trim?.out ?? durationSec,
  },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: durationSec,
})

const sessionWith = (blocks: EditBlock[]): EditSession =>
  ({
    schema_version: 3,
    id: 's1',
    project_id: 'p1',
    name: 'test',
    overlay_snapshot: {},
    sequence: blocks,
    sequence_block_gaps: [0],
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

describe('sequenceBlockGaps', () => {
  it('keeps the next block start fixed when ripple is off and duration shrinks', () => {
    const session = sessionWith([block('a', 5), block('b', 5)])
    const before = buildCompositionTimeline(session.sequence, 0.35, session.sequence_block_gaps)
    const nextStartBefore = before.segments[1]!.compositionStartSec

    const trimmed = session.sequence[0]!
    const oldTrim = { in_sec: trimmed.trim.in_sec, out_sec: trimmed.trim.out_sec }
    trimmed.trim.out_sec = 3
    absorbBlockDurationDeltaWithGap(session, 0, oldTrim, trimmed)

    const after = buildCompositionTimeline(session.sequence, 0.35, session.sequence_block_gaps)
    expect(after.segments[1]!.compositionStartSec).toBeCloseTo(nextStartBefore, 3)
    expect(session.sequence_block_gaps![0]).toBeCloseTo(2, 3)
  })

  it('does not overlap adjacent blocks after head trim', () => {
    const first = block('a', 10, { in: 0, out: 10 })
    const second = block('b', 10, { in: 0, out: 10 })
    first.trim.in_sec = 2
    const timeline = buildCompositionTimeline([first, second], 0.35)
    const seg0 = timeline.segments[0]!
    const seg1 = timeline.segments[1]!
    const end0 = blockTimelineVisualEndSec(seg0.compositionStartSec, seg0.block)
    const start1 = blockTimelineVisualStartSec(seg1.compositionStartSec, seg1.block)
    expect(end0).toBeLessThanOrEqual(start1 + 0.001)
  })

  it('blocks left extend into the previous clip body', () => {
    const session = sessionWith([block('a', 10), block('b', 10)])
    session.sequence_block_gaps = [0]
    const second = session.sequence[1]!
    applyVideoHeadTrimClamp(session, 1, second, {
      fixedOutSec: 10,
      proposedVisualStartSec: 5,
    })
    const timeline = buildCompositionTimeline(session.sequence, 0.35, session.sequence_block_gaps)
    const seg0 = timeline.segments[0]!
    const seg1 = timeline.segments[1]!
    const end0 = blockTimelineVisualEndSec(seg0.compositionStartSec, seg0.block)
    const start1 = blockTimelineVisualStartSec(seg1.compositionStartSec, seg1.block)
    expect(start1).toBeGreaterThanOrEqual(end0 - 0.001)
  })
})
