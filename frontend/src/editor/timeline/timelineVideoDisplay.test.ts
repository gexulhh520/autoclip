import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import { buildCompositionTimelineSegments } from '../scene/timelineLayout'
import { buildVideoTimelineDisplayLayout } from './timelineVideoDisplay'
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

describe('buildVideoTimelineDisplayLayout', () => {
  it('keeps adjacent video blocks from overlapping when a cross transition exists', () => {
    const segments = buildCompositionTimelineSegments(
      [block('a', 5, 'dissolve'), block('b', 4, 'cut')],
      50,
      0.35
    )
    const layout = buildVideoTimelineDisplayLayout(segments)
    const clipA = layout.clips[0]!
    const clipB = layout.clips[1]!
    const dissolve = segments[0]!.dissolveOutSec

    expect(clipA.displayStartSec + clipA.displayDurationSec).toBeCloseTo(
      layout.transitions[0]!.startSec,
      3
    )
    expect(clipA.displayDurationSec).toBeCloseTo(5 - dissolve, 3)
    expect(clipB.displayStartSec).toBeGreaterThanOrEqual(
      clipA.displayStartSec + clipA.displayDurationSec - 0.001
    )
    expect(layout.transitions).toHaveLength(1)
    expect(layout.transitions[0]!.durationSec).toBeCloseTo(dissolve, 3)
  })

  it('shows full visual spans when there is no cross transition', () => {
    const segments = buildCompositionTimelineSegments(
      [block('a', 5), block('b', 4)],
      50,
      0.35,
      [1]
    )
    const layout = buildVideoTimelineDisplayLayout(segments)
    const segA = segments[0]!
    const segB = segments[1]!

    expect(layout.transitions).toHaveLength(0)
    expect(layout.clips[0]!.displayDurationSec).toBeCloseTo(5, 3)
    expect(layout.clips[1]!.displayStartSec).toBeCloseTo(
      blockTimelineVisualStartSec(segB.startSec, segB.block),
      3
    )
    expect(layout.clips[0]!.displayStartSec + layout.clips[0]!.displayDurationSec).toBeLessThan(
      layout.clips[1]!.displayStartSec
    )
  })

  it('places the transition marker on the dissolve overlap range', () => {
    const segments = buildCompositionTimelineSegments(
      [block('a', 5, 'fade_black'), block('b', 4, 'cut')],
      50,
      0.35
    )
    const layout = buildVideoTimelineDisplayLayout(segments)
    const segA = segments[0]!
    const visualEnd = blockTimelineVisualEndSec(segA.startSec, segA.block)
    const marker = layout.transitions[0]!

    expect(marker.startSec + marker.durationSec).toBeCloseTo(visualEnd, 3)
    expect(marker.kind).toBe('fade_black')
  })
})
