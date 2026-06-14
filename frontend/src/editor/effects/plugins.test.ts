import { describe, expect, it, afterEach } from 'vitest'
import { getEffect, listEffects } from './registry'
import {
  clearEffectPluginsForTests,
  listEffectPlugins,
  registerEffectPlugin,
} from './plugins'

describe('Effect plugins', () => {
  afterEach(() => {
    clearEffectPluginsForTests()
  })

  it('registerEffectPlugin exposes effects via registry', () => {
    registerEffectPlugin({
      id: 'demo.vendor',
      version: '1.0.0',
      label: 'Demo Vendor',
      effects: [
        {
          id: 'filter.demo_glow',
          category: 'filter',
          label: 'Demo Glow',
          frameEffectId: 'visual_filter.demo_glow',
        },
      ],
    })
    expect(listEffectPlugins()).toHaveLength(1)
    expect(getEffect('filter.demo_glow')?.pluginId).toBe('demo.vendor')
    expect(listEffects('filter').some((item) => item.id === 'filter.demo_glow')).toBe(true)
  })
})
