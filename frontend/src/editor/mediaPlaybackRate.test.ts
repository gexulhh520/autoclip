import { describe, expect, it } from 'vitest'
import { applyMediaPlaybackRate, clampMediaPlaybackRate } from './mediaPlaybackRate'

describe('clampMediaPlaybackRate', () => {
  it('clamps out-of-range values', () => {
    expect(clampMediaPlaybackRate(8)).toBe(4)
    expect(clampMediaPlaybackRate(0.1)).toBe(0.25)
  })
})

describe('applyMediaPlaybackRate', () => {
  it('sets rate and disables pitch preservation', () => {
    const media = {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      preservesPitch: true,
    } as HTMLMediaElement

    applyMediaPlaybackRate(media, 2)
    expect(media.playbackRate).toBe(2)
    expect(media.defaultPlaybackRate).toBe(2)
    expect(media.preservesPitch).toBe(false)
  })
})
