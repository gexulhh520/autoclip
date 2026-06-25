import { describe, expect, it } from 'vitest'
import {
  applyTextPresetToParams,
  readTextPresetId,
  SUBTITLE_STYLE_PRESETS,
} from './textPresets'

describe('subtitle text presets', () => {
  it('lists seven subtitle styles', () => {
    expect(SUBTITLE_STYLE_PRESETS).toHaveLength(7)
  })

  it('applies white hollow preset with transparent fill and outline', () => {
    const next = applyTextPresetToParams({ content: '测试', color: '#000000' }, 'text.preset.subtitle.white_hollow')
    expect(next.color).toBe('rgba(255,255,255,0)')
    expect(next['outline.enabled']).toBe(true)
    expect(next['outline.color']).toBe('#ffffff')
    expect(readTextPresetId(next)).toBe('text.preset.subtitle.white_hollow')
  })

  it('applies colored outline preset', () => {
    const next = applyTextPresetToParams({}, 'text.preset.subtitle.white_red_outline')
    expect(next.color).toBe('#ffffff')
    expect(next['outline.enabled']).toBe(true)
    expect(next['outline.color']).toBe('#e84b4b')
  })

  it('preserves content when applying preset', () => {
    const next = applyTextPresetToParams({ content: '保留文案' }, 'text.preset.subtitle.yellow')
    expect(next.content).toBe('保留文案')
    expect(next.color).toBe('#ffe566')
  })
})
