import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  applyInteractiveVideoHeadTrim,
  buildVideoTrimInteractiveContext,
} from './videoTrimInteractive'

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

describe('videoTrimInteractive', () => {
  it('clamps head trim without rebuilding timeline', () => {
    const first = block('a', 10)
    const second = block('b', 10)
    const segments = [
      { startSec: 0, dissolveOutSec: 0, block: first },
      { startSec: 10, dissolveOutSec: 0, block: second },
    ]
    const ctx = buildVideoTrimInteractiveContext(second, 1, segments, 10)!
    applyInteractiveVideoHeadTrim(second, ctx, 5)
    expect(second.trim.in_sec).toBe(0)
    expect(second.trim.out_sec).toBe(10)
  })
})
