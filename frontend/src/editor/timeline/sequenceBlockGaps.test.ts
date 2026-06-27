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
  areMainTrackBlocksAdjacent,
  dropCrossTransitionsBrokenByGaps,
  mainTrackSegmentSeparationSec,
  normalizeOverlayVideoBlocksToSequenceEnd,
  preserveMainTrackTimingGapForOverlayMove,
  readSequenceBlockGaps,
  resolveMainTrackCompositionGaps,
} from './sequenceBlockGaps'
import { resolveMainTrackSequentialBlocks } from '../videoTracks'

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

  it('removes cross transition when tail shorten opens gap beyond dissolve duration', () => {
    const first = block('a', 5)
    first.transition_out = 'dissolve'
    const session = sessionWith([first, block('b', 5)])

    const trimmed = session.sequence[0]!
    const oldTrim = { in_sec: trimmed.trim.in_sec, out_sec: trimmed.trim.out_sec }
    trimmed.trim.out_sec = 3
    absorbBlockDurationDeltaWithGap(session, 0, oldTrim, trimmed)

    expect(session.sequence_block_gaps![0]).toBeGreaterThan(0.35)
    expect(dropCrossTransitionsBrokenByGaps(session)).toBe(true)
    expect(session.sequence[0]!.transition_out).toBe('cut')
  })

  it('does not restore cross transition when clip is lengthened again', () => {
    const first = block('a', 5)
    first.transition_out = 'dissolve'
    const session = sessionWith([first, block('b', 5)])

    const trimmed = session.sequence[0]!
    const oldTrim = { in_sec: trimmed.trim.in_sec, out_sec: trimmed.trim.out_sec }
    trimmed.trim.out_sec = 3
    absorbBlockDurationDeltaWithGap(session, 0, oldTrim, trimmed)
    dropCrossTransitionsBrokenByGaps(session)
    expect(session.sequence[0]!.transition_out).toBe('cut')

    session.sequence_block_gaps![0] = 0
    trimmed.trim.out_sec = 5
    expect(dropCrossTransitionsBrokenByGaps(session)).toBe(false)
    expect(session.sequence[0]!.transition_out).toBe('cut')
  })

  it('removes cross transition when head trim separates clips beyond dissolve duration', () => {
    const first = block('a', 5)
    first.transition_out = 'fade_black'
    const second = block('b', 5)
    const session = sessionWith([first, second])

    second.trim.in_sec = 1
    expect(dropCrossTransitionsBrokenByGaps(session)).toBe(true)
    expect(session.sequence[0]!.transition_out).toBe('cut')
  })

  it('blocks head trim overlap after split continuation block', () => {
    const first = block('a', 10, { in: 0, out: 4 })
    const second: EditBlock = {
      ...block('b', 10, { in: 0, out: 6 }),
      media: {
        ...block('b', 10).media,
        clip_file_start_sec: 4,
      },
    }
    const session = sessionWith([first, second])
    applyVideoHeadTrimClamp(session, 1, second, {
      fixedOutSec: 6,
      proposedVisualStartSec: 1,
    })
    const timeline = buildCompositionTimeline(session.sequence, 0.35, session.sequence_block_gaps)
    const end0 = blockTimelineVisualEndSec(
      timeline.segments[0]!.compositionStartSec,
      timeline.segments[0]!.block
    )
    const start1 = blockTimelineVisualStartSec(
      timeline.segments[1]!.compositionStartSec,
      timeline.segments[1]!.block
    )
    expect(start1).toBeGreaterThanOrEqual(end0 - 0.001)
  })

  it('reports adjacency only when visual ends meet', () => {
    const session = sessionWith([block('a', 5), block('b', 5)])
    expect(areMainTrackBlocksAdjacent(session, 0)).toBe(true)
    expect(mainTrackSegmentSeparationSec(session, 0)).toBeCloseTo(0, 3)

    session.sequence_block_gaps![0] = 1
    expect(areMainTrackBlocksAdjacent(session, 0)).toBe(false)
    expect(mainTrackSegmentSeparationSec(session, 0)).toBeCloseTo(1, 3)
  })

  it('preserves following main block start when middle block leaves for overlay', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence_block_gaps = [0, 0]
    const mainBlocks = resolveMainTrackSequentialBlocks(session)
    const before = buildCompositionTimeline(
      mainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, mainBlocks)
    )
    const cStartBefore = before.segments[2]!.compositionStartSec

    preserveMainTrackTimingGapForOverlayMove(session, 1, 5)
    session.sequence[1]!.track_id = 'overlay-track'
    session.sequence[1]!.timeline_start_sec = 5

    const afterMainBlocks = resolveMainTrackSequentialBlocks(session)
    const after = buildCompositionTimeline(
      afterMainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, afterMainBlocks)
    )
    expect(after.segments[1]!.block.id).toBe('c')
    expect(after.segments[1]!.compositionStartSec).toBeCloseTo(cStartBefore, 3)
    expect(session.sequence_block_gaps![0]).toBeCloseTo(5, 3)
  })

  it('resolveMainTrackCompositionGaps sums gaps across non-main blocks in sequence', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence[1]!.track_id = 'overlay-track'
    session.sequence[1]!.timeline_start_sec = 5
    session.sequence_block_gaps = [2, 3]

    const mainBlocks = resolveMainTrackSequentialBlocks(session)
    expect(resolveMainTrackCompositionGaps(session, mainBlocks)).toEqual([5])
  })

  it('main track composition does not overlap when overlay block sits in sequence middle', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence[1]!.track_id = 'overlay-track'
    session.sequence[1]!.timeline_start_sec = 5
    session.sequence_block_gaps = [5, 0]

    const mainBlocks = resolveMainTrackSequentialBlocks(session)
    const timeline = buildCompositionTimeline(
      mainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, mainBlocks)
    )
    const endA = blockTimelineVisualEndSec(
      timeline.segments[0]!.compositionStartSec,
      timeline.segments[0]!.block
    )
    const startC = blockTimelineVisualStartSec(
      timeline.segments[1]!.compositionStartSec,
      timeline.segments[1]!.block
    )
    expect(startC).toBeGreaterThanOrEqual(endA - 0.001)
  })

  it('normalizeOverlayVideoBlocksToSequenceEnd moves intruder to tail and rebuilds gaps', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence[1]!.track_id = 'overlay-track'
    session.sequence[1]!.timeline_start_sec = 5
    session.sequence_block_gaps = [5, 0]

    expect(normalizeOverlayVideoBlocksToSequenceEnd(session)).toBe(true)
    expect(session.sequence.map((item) => item.id)).toEqual(['a', 'c', 'b'])
    expect(session.sequence_block_gaps).toEqual([5, 0])
  })

  it('resolveMainTrackCompositionGaps does not mutate frozen session gaps', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence_block_gaps = Object.freeze([0, 0]) as number[]
    const mainBlocks = resolveMainTrackSequentialBlocks(session)

    expect(resolveMainTrackCompositionGaps(session, mainBlocks)).toEqual([0, 0])
    expect(Object.isFrozen(session.sequence_block_gaps)).toBe(true)
  })

  it('readSequenceBlockGaps normalizes length without mutating session', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence_block_gaps = Object.freeze([0]) as number[]

    expect(readSequenceBlockGaps(session)).toEqual([0, 0])
    expect(session.sequence_block_gaps).toEqual([0])
    expect(Object.isFrozen(session.sequence_block_gaps)).toBe(true)
  })
})
