import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  buildCompositionTimeline,
  buildCompositionTimelineSegments,
} from '../scene/timelineLayout'
import { buildVideoTimelineTransitionMarkers } from './timelineVideoDisplay'
import {
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'

const block = (
  id: string,
  durationSec: number,
  transition: EditBlock['transition_out'] = 'cut'
): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: durationSec },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: transition,
  duration_sec: durationSec,
})

describe('buildVideoTimelineTransitionMarkers', () => {
  it('does not change following segment placement when transition is added', () => {
    const blocks = [block('a', 5), block('b', 4)]
    const without = buildCompositionTimeline(blocks, 0.35)
    blocks[0]!.transition_out = 'dissolve'
    const withTransition = buildCompositionTimeline(blocks, 0.35)

    expect(withTransition.segments[1]!.compositionStartSec).toBeCloseTo(
      without.segments[1]!.compositionStartSec,
      3
    )
    expect(withTransition.totalDurationSec).toBeCloseTo(without.totalDurationSec, 3)
  })

  it('emits a marker on the outgoing tail without shortening clip display', () => {
    const segments = buildCompositionTimelineSegments(
      [block('a', 5, 'dissolve'), block('b', 4, 'cut')],
      50,
      0.35
    )
    const markers = buildVideoTimelineTransitionMarkers(segments)
    const segA = segments[0]!
    const visualStart = blockTimelineVisualStartSec(segA.startSec, segA.block)
    const visualEnd = blockTimelineVisualEndSec(segA.startSec, segA.block)
    const dissolve = segA.dissolveOutSec

    expect(markers).toHaveLength(1)
    expect(markers[0]!.startSec).toBeCloseTo(visualEnd - dissolve, 3)
    expect(markers[0]!.durationSec).toBeCloseTo(dissolve, 3)
    expect(visualEnd - visualStart).toBeCloseTo(5, 3)
  })

  it('omits markers when clips are separated by a gap', () => {
    const segments = buildCompositionTimelineSegments(
      [block('a', 5, 'dissolve'), block('b', 4, 'cut')],
      50,
      0.35,
      [1]
    )
    expect(segments[0]!.dissolveOutSec).toBe(0)
    expect(buildVideoTimelineTransitionMarkers(segments)).toHaveLength(0)
  })

  it('omits markers when there is no cross transition', () => {
    const segments = buildCompositionTimelineSegments(
      [block('a', 5), block('b', 4)],
      50,
      0.35,
      [1]
    )
    expect(buildVideoTimelineTransitionMarkers(segments)).toHaveLength(0)
  })
})
