import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_FONT_FAMILY,
  EDITOR_TEXT_FONTS,
  isBundledTextFont,
} from './catalog'
import { collectTextLayerFontFamilies } from './loadEditorFonts'
import type { EditSession } from '../../types/editSession'

describe('editor text fonts', () => {
  it('includes bundled and system fonts', () => {
    expect(EDITOR_TEXT_FONTS.length).toBeGreaterThanOrEqual(10)
    expect(isBundledTextFont('Noto Sans SC')).toBe(true)
    expect(isBundledTextFont('PingFang SC')).toBe(false)
  })

  it('collects font families from overlay text layers', () => {
    const session = {
      overlay_elements: [
        { params: { fontFamily: 'ZCOOL KuaiLe' } },
        { params: { fontFamily: 'Noto Serif SC' } },
      ],
    } as unknown as EditSession

    const families = collectTextLayerFontFamilies(session)
    expect(families).toContain(DEFAULT_TEXT_FONT_FAMILY)
    expect(families).toContain('ZCOOL KuaiLe')
    expect(families).toContain('Noto Serif SC')
  })
})
