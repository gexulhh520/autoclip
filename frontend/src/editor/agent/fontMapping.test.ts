import { describe, expect, it } from 'vitest'
import { mapFontFamily } from './fontMapping'

describe('mapFontFamily', () => {
  it('maps serif to Noto Serif SC', () => {
    expect(mapFontFamily('serif')).toBe('Noto Serif SC')
  })

  it('maps cursive to Ma Shan Zheng', () => {
    expect(mapFontFamily('cursive')).toBe('Ma Shan Zheng')
  })

  it('falls back to Noto Sans SC', () => {
    expect(mapFontFamily('unknown-font-xyz')).toBe('Noto Sans SC')
  })
})
