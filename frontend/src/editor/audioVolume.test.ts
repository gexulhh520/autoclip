import { describe, expect, it } from 'vitest'
import { clampHtmlMediaVolume } from './audioVolume'

describe('clampHtmlMediaVolume', () => {
  it('clamps to [0, 1]', () => {
    expect(clampHtmlMediaVolume(1.05)).toBe(1)
    expect(clampHtmlMediaVolume(2)).toBe(1)
    expect(clampHtmlMediaVolume(-0.2)).toBe(0)
    expect(clampHtmlMediaVolume(0.85)).toBe(0.85)
  })

  it('returns 0 for non-finite values', () => {
    expect(clampHtmlMediaVolume(Number.NaN)).toBe(0)
  })
})
