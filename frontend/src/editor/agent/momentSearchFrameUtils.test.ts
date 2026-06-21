import { describe, expect, it } from 'vitest'
import {
  MOMENT_SEARCH_FRAME_LIMITS,
  resolveMomentSearchFrameSampleCount,
} from './momentSearchFrameUtils'

describe('momentSearchFrameUtils', () => {
  it('caps long video sample count', () => {
    expect(resolveMomentSearchFrameSampleCount(7200)).toBe(MOMENT_SEARCH_FRAME_LIMITS.MAX)
    expect(resolveMomentSearchFrameSampleCount(600)).toBeLessThanOrEqual(
      MOMENT_SEARCH_FRAME_LIMITS.MAX
    )
  })

  it('uses more frames for short clips', () => {
    expect(resolveMomentSearchFrameSampleCount(45)).toBeGreaterThanOrEqual(
      MOMENT_SEARCH_FRAME_LIMITS.MIN
    )
  })
})
