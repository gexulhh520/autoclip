import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../types/editSession'
import { buildTimelineSegments } from './editTimeline'
import {
  computeDissolveDuration,
  getEffectiveSequenceDuration,
  resolveDissolvePreview,
} from './editDissolvePreview'

const block = (id: string, duration: number, transition: 'cut' | 'dissolve' = 'cut'): EditBlock => ({
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

describe('editDissolvePreview', () => {
  it('computes dissolve duration cap', () => {
    expect(computeDissolveDuration(10, 0.35)).toBe(0.35)
    expect(computeDissolveDuration(0.5, 0.35)).toBe(0.225)
  })

  it('resolves crossfade state near segment tail', () => {
    const blocks = [block('a', 4, 'dissolve'), block('b', 3)]
    const segments = buildTimelineSegments(blocks, 24)
    const state = resolveDissolvePreview(3.8, segments, 0.35)
    expect(state).not.toBeNull()
    expect(state?.incoming.block.id).toBe('b')
    expect(state?.progress).toBeGreaterThan(0)
  })

  it('keeps full sequence duration when dissolve transitions exist', () => {
    const blocks = [block('a', 4, 'dissolve'), block('b', 3)]
    expect(getEffectiveSequenceDuration(blocks, 0.35)).toBeCloseTo(7, 2)
  })
})
