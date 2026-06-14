import { describe, expect, it } from 'vitest'
import { FILTER_EFFECT_PASS_PRESETS, isGpuEffectPassAvailable } from './effectPass'
import { getEffect } from './registry'

describe('effectPass', () => {
  it('registers gpu pass on visual filters', () => {
    const effect = getEffect('filter.mono_soft')
    expect(effect?.effectPass).toBeDefined()
    expect(FILTER_EFFECT_PASS_PRESETS['visual_filter.mono_soft']).toBeDefined()
  })

  it('reports gpu availability in jsdom', () => {
    expect(typeof isGpuEffectPassAvailable()).toBe('boolean')
  })
})
