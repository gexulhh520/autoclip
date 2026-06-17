import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  buildCompositionTimeline,
  findCrossTransitionAtTime,
  mainTrackTransitionJunctionSec,
  mapCompositionTimeToRelativeSource,
  mapIncomingRelativeDuringCrossTransition,
  resolveCrossTransitionWindow,
} from './timelineLayout'

const block = (
  id: string,
  duration: number,
  transition: EditBlock['transition_out'] = 'cut'
): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: transition,
  duration_sec: duration,
})

describe('timelineLayout transition continuity', () => {
  it('centers cross transition window on junction between adjacent clips', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    const outgoing = timeline.segments[0]!
    const incoming = timeline.segments[1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)!

    expect(window.junctionSec).toBeCloseTo(mainTrackTransitionJunctionSec(outgoing, incoming), 3)
    expect(window.startSec).toBeCloseTo(window.junctionSec - window.durationSec / 2, 3)
    expect(window.endSec).toBeCloseTo(window.junctionSec + window.durationSec / 2, 3)

    const atStart = findCrossTransitionAtTime(timeline, window.startSec)
    const atCenter = findCrossTransitionAtTime(timeline, window.junctionSec)
    const atEnd = findCrossTransitionAtTime(timeline, window.endSec)

    expect(atStart?.progress).toBeCloseTo(0, 3)
    expect(atCenter?.progress).toBeCloseTo(0.5, 3)
    expect(atEnd?.progress).toBeCloseTo(1, 3)
  })

  it('keeps incoming source time continuous across transition end', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    const outgoing = timeline.segments[0]!
    const incoming = timeline.segments[1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)!
    const justBeforeEnd = window.endSec - 0.001
    const justAfterEnd = window.endSec + 0.002

    const cross = findCrossTransitionAtTime(timeline, justBeforeEnd)
    expect(cross).not.toBeNull()

    const inAtEnd = mapIncomingRelativeDuringCrossTransition(
      outgoing,
      incoming,
      justBeforeEnd
    )
    const inAfter = mapCompositionTimeToRelativeSource(incoming, justAfterEnd, timeline)

    expect(inAfter).toBeGreaterThan(inAtEnd - 0.01)
    expect(inAfter - inAtEnd).toBeCloseTo(0.003, 3)
  })
})
