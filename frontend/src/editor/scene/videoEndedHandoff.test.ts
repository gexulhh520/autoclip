import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import { buildCompositionTimeline } from './timelineLayout'
import { resolveVideoEndedHandoff } from './videoEndedHandoff'

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

describe('resolveVideoEndedHandoff', () => {
  it('ignores ended while still inside cross transition window', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    expect(resolveVideoEndedHandoff(timeline, 3.9, 'a', 7)).toBeNull()
  })

  it('ignores ended when playhead already on incoming segment', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    expect(resolveVideoEndedHandoff(timeline, 4.2, 'a', 7)).toBeNull()
  })

  it('stops only when the last clip ends', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    const result = resolveVideoEndedHandoff(timeline, 6.9, 'b', 7)
    expect(result?.stopPlayback).toBe(true)
    expect(result?.nextPlayheadSec).toBeCloseTo(7, 2)
  })

  it('advances to cross end when outgoing ends early during cross transition', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    const result = resolveVideoEndedHandoff(timeline, 3.5, 'a', 7)
    expect(result?.nextPlayheadSec).toBeCloseTo(4.195, 2)
    expect(result?.stopPlayback).toBe(false)
  })
})
