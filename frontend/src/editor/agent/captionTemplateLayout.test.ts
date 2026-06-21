import { describe, expect, it } from 'vitest'
import {
  normalizeCaptionLayout,
  normalizeCaptionPosition,
  resolveCaptionPlacement,
  resolveLayoutAndPosition,
} from './captionTemplateLayout'

describe('captionTemplateLayout', () => {
  it('normalizes Chinese position aliases', () => {
    expect(normalizeCaptionPosition('右上')).toBe('top_right')
    expect(normalizeCaptionPosition('底部')).toBe('bottom_center')
    expect(normalizeCaptionPosition('偏左')).toBe('center_left')
  })

  it('resolves layout and position independently', () => {
    const resolved = resolveLayoutAndPosition({
      layout: 'vertical',
      position: 'top_right',
    })
    expect(resolved.layout).toBe('vertical')
    expect(resolved.position).toBe('top_right')
  })

  it('maps legacy vertical_stagger template', () => {
    const resolved = resolveLayoutAndPosition({ template: 'vertical_stagger' })
    expect(resolved.layout).toBe('vertical')
    expect(resolved.position).toBe('bottom_center')
  })

  it('places horizontal bottom_center below center', () => {
    const placement = resolveCaptionPlacement({
      layout: 'horizontal',
      position: 'bottom_center',
      text: '横排字幕',
      canvasWidth: 1080,
      canvasHeight: 1920,
    })
    expect(placement.splitChars).toBe(false)
    expect(placement.layout).toBe('horizontal')
    expect(placement.positionY).toBeGreaterThan(0)
  })

  it('vertical layout splits chars at top_right anchor', () => {
    const placement = resolveCaptionPlacement({
      layout: 'vertical',
      position: 'top_right',
      text: '春风',
      canvasWidth: 1080,
      canvasHeight: 1920,
    })
    expect(placement.splitChars).toBe(true)
    expect(placement.position).toBe('top_right')
    expect(placement.normalizedCenter.x).toBeGreaterThan(0.8)
  })

  it('normalizes layout from 竖排', () => {
    expect(normalizeCaptionLayout('竖排')).toBe('vertical')
  })
})
