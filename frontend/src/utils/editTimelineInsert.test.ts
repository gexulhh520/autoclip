import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../types/editSession'
import { blockDuration, blockTimelineVisualStartSec, resolveInsertIndexForPlayhead } from './editTimeline'

const block = (id: string, duration: number): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: duration,
})

describe('resolveInsertIndexForPlayhead', () => {
  it('inserts at 0 on empty timeline', () => {
    expect(resolveInsertIndexForPlayhead([], 0, 0.35)).toBe(0)
  })

  it('inserts before current block when playhead is in left half', () => {
    const blocks = [block('a', 4), block('b', 3)]
    expect(resolveInsertIndexForPlayhead(blocks, 1, 0.35)).toBe(0)
  })

  it('inserts after current block when playhead is in right half', () => {
    const blocks = [block('a', 4), block('b', 3)]
    expect(resolveInsertIndexForPlayhead(blocks, 3, 0.35)).toBe(1)
  })

  it('uses second block index when playhead is on later segment', () => {
    const blocks = [block('a', 4), block('b', 3)]
    expect(resolveInsertIndexForPlayhead(blocks, 5.5, 0.35)).toBe(2)
    expect(resolveInsertIndexForPlayhead(blocks, 4.5, 0.35)).toBe(1)
  })
})

describe('blockTimelineVisualStartSec', () => {
  it('moves visual start right on head trim so the end stays fixed', () => {
    const b = block('a', 10)
    b.trim.in_sec = 2
    expect(blockTimelineVisualStartSec(5, b)).toBe(7)
    expect(blockDuration(b)).toBe(8)
    expect(blockTimelineVisualStartSec(5, b) + blockDuration(b)).toBe(15)
  })
})
