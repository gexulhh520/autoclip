import { describe, expect, it } from 'vitest'
import {
  normalizeCaptionTemplateId,
  resolveCaptionFontSize,
  resolveCaptionPlacement,
} from './captionTemplateLayout'

describe('captionTemplateLayout', () => {
  it('normalizes vertical template aliases', () => {
    expect(normalizeCaptionTemplateId('vertical_stagger')).toBe('vertical_stagger')
    expect(normalizeCaptionTemplateId('竖排')).toBe('vertical_stagger')
  })

  it('places vertical_stagger in lower safe zone', () => {
    const placement = resolveCaptionPlacement({
      template: 'vertical_stagger',
      text: '春风得意',
      canvasWidth: 1080,
      canvasHeight: 1920,
    })
    expect(placement.splitChars).toBe(true)
    expect(placement.layout).toBe('vertical')
    expect(placement.positionY).toBeGreaterThan(0)
    expect(placement.fontSize).toBeGreaterThanOrEqual(5)
  })

  it('shrinks font for long text', () => {
    expect(resolveCaptionFontSize(6.5, 4)).toBeGreaterThan(resolveCaptionFontSize(6.5, 12))
  })
})
