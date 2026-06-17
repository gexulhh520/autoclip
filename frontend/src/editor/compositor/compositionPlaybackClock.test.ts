import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompositionPlaybackClock } from './compositionPlaybackClock'

describe('compositionPlaybackClock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('advances composition time linearly from wall clock', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const clock = createCompositionPlaybackClock()
    clock.startAt(2, 1000)
    now = 1500
    expect(clock.read(10)).toBeCloseTo(2.5, 3)
    now = 2000
    expect(clock.read(10)).toBeCloseTo(3, 3)
  })

  it('clamps to total duration', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const clock = createCompositionPlaybackClock()
    clock.startAt(9, 1000)
    now = 2000
    expect(clock.read(10)).toBe(10)
  })
})
