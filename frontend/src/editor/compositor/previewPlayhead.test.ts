import { describe, expect, it } from 'vitest'
import { easeInOutCubic } from './previewPlayhead'

describe('previewPlayhead easing', () => {
  it('easeInOutCubic is monotonic and ends at 0 and 1', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })
})
