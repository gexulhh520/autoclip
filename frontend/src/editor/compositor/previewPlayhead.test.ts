import { describe, expect, it } from 'vitest'
import { easeInOutCubic, playbackRateForDrift } from './previewPlayhead'

describe('previewPlayhead easing', () => {
  it('easeInOutCubic is monotonic and ends at 0 and 1', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })
})

describe('playbackRateForDrift', () => {
  it('returns 1 inside deadband', () => {
    expect(playbackRateForDrift(0)).toBe(1)
    expect(playbackRateForDrift(0.02)).toBe(1)
    expect(playbackRateForDrift(-0.02)).toBe(1)
  })

  it('nudges rate when audio lags behind composition time', () => {
    expect(playbackRateForDrift(0.12)).toBeGreaterThan(1)
    expect(playbackRateForDrift(-0.12)).toBeLessThan(1)
  })
})
