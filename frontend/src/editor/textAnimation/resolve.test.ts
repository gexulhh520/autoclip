import { describe, expect, it } from 'vitest'
import { resolveTextAnimationState } from './resolve'
import type { TextAnimationConfig } from './types'

const canvasHeight = 1080

describe('resolveTextAnimationState', () => {
  it('fade in at start', () => {
    const config: TextAnimationConfig = {
      in: { type: 'fade', durationSec: 0.5 },
      out: { type: 'none', durationSec: 0.4 },
      loop: { type: 'none', durationSec: 1 },
    }
    const atStart = resolveTextAnimationState(0, 3, config, canvasHeight)
    const mid = resolveTextAnimationState(0.5, 3, config, canvasHeight)
    expect(atStart.opacity).toBe(0)
    expect(mid.opacity).toBe(1)
  })

  it('fade out at end', () => {
    const config: TextAnimationConfig = {
      in: { type: 'none', durationSec: 0.4 },
      out: { type: 'fade', durationSec: 0.5 },
      loop: { type: 'none', durationSec: 1 },
    }
    const before = resolveTextAnimationState(2.4, 3, config, canvasHeight)
    const atEnd = resolveTextAnimationState(3, 3, config, canvasHeight)
    expect(before.opacity).toBeGreaterThan(0.5)
    expect(atEnd.opacity).toBe(0)
  })

  it('pulse loop changes scale', () => {
    const config: TextAnimationConfig = {
      in: { type: 'none', durationSec: 0.4 },
      out: { type: 'none', durationSec: 0.4 },
      loop: { type: 'pulse', durationSec: 1 },
    }
    const a = resolveTextAnimationState(0, 3, config, canvasHeight)
    const b = resolveTextAnimationState(0.25, 3, config, canvasHeight)
    expect(a.scale).not.toBe(b.scale)
  })
})
