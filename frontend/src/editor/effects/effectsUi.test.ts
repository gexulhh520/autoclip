import { describe, expect, it } from 'vitest'
import { getEffect, listEffects } from './registry'
import { listTransitionUiOptions, listVisualFilterUiOptions } from './ui'

describe('Effect Registry UI', () => {
  it('listVisualFilterUiOptions mirrors registered filters', () => {
    const options = listVisualFilterUiOptions()
    expect(options.length).toBeGreaterThanOrEqual(5)
    expect(options.find((item) => item.value === 'mono_soft')?.label).toBe('柔和单色')
  })

  it('listTransitionUiOptions exposes all builtin transitions', () => {
    const options = listTransitionUiOptions()
    expect(options.length).toBe(10)
    expect(options.some((item) => item.value === 'dissolve')).toBe(true)
    expect(options.some((item) => item.value === 'cut')).toBe(true)
    expect(options.some((item) => item.value === 'wipe_left')).toBe(true)
    expect(options.some((item) => item.value === 'zoom')).toBe(true)
  })

  it('registers text preset slots', () => {
    expect(getEffect('text.preset.cinema_glow')).toBeDefined()
    expect(listEffects('text').some((item) => item.id.startsWith('text.preset.'))).toBe(true)
  })
})
