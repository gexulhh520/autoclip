import { describe, expect, it } from 'vitest'
import { normalizeVisualFilterId, visualFilterLabel } from './setVisualFilter'

describe('setVisualFilter', () => {
  it('normalizes Chinese aliases', () => {
    expect(normalizeVisualFilterId('高对比')).toBe('mono_contrast')
    expect(normalizeVisualFilterId('冷色克制')).toBe('mono_cool')
    expect(normalizeVisualFilterId('mono_warm')).toBe('mono_warm')
  })

  it('labels filters', () => {
    expect(visualFilterLabel('mono_contrast')).toBe('高对比')
  })
})
