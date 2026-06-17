import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  buildCompositionTimeline,
  findCrossTransitionAtTime,
  mapCompositionTimeToRelativeSource,
  mapIncomingRelativeDuringCrossTransition,
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
  it('keeps incoming source time continuous across transition end', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    const outgoing = timeline.segments[0]!
    const incoming = timeline.segments[1]!
    const dissolveEnd = 4
    const justBeforeEnd = dissolveEnd - 0.001
    const justAfterEnd = dissolveEnd + 0.002

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
