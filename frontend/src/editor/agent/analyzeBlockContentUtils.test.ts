import { describe, expect, it } from 'vitest'
import {
  resolveAnalyzeBlockId,
  resolveSampleTimesSec,
  summarizeAudioSegments,
} from './analyzeBlockContentUtils'

describe('analyzeBlockContentUtils', () => {
  it('resolves block id from focused block first', () => {
    expect(
      resolveAnalyzeBlockId({
        args: {},
        focusedBlockId: 'focus-1',
        selectedBlockId: 'sel-1',
      })
    ).toBe('focus-1')
    expect(
      resolveAnalyzeBlockId({
        args: { block_id: 'arg-1' },
        focusedBlockId: 'focus-1',
        selectedBlockId: 'sel-1',
      })
    ).toBe('arg-1')
  })

  it('samples evenly across timeline window', () => {
    const times = resolveSampleTimesSec(
      { start_sec: 10, end_sec: 20, duration_sec: 10 },
      3
    )
    expect(times).toHaveLength(3)
    expect(times[0]).toBeCloseTo(11.666, 2)
    expect(times[2]).toBeCloseTo(18.333, 2)
  })

  it('builds speech and silence segments from silence regions', () => {
    const summary = summarizeAudioSegments(
      {
        id: 'b1',
        trim: { in_sec: 0, out_sec: 10 },
      } as never,
      [
        { start_sec: 2, end_sec: 3 },
        { start_sec: 6, end_sec: 7 },
      ],
      [5],
      { in_sec: 0.5, out_sec: 9.5 }
    )
    expect(summary.segments).toHaveLength(5)
    expect(summary.segments[0]?.kind).toBe('speech')
    expect(summary.segments[1]?.kind).toBe('silence')
    expect(summary.speech_ratio).toBeGreaterThan(0.5)
    expect(summary.split_points).toEqual([5])
  })
})
