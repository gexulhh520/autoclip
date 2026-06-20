import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  buildStaggeredCharOverlays,
  splitTextContentToChars,
} from './staggeredCharText'

describe('staggeredCharText', () => {
  it('splits chinese content to chars', () => {
    expect(splitTextContentToChars('我 爱你')).toEqual(['我', '爱', '你'])
  })

  it('builds staggered overlays with increasing start_sec', () => {
    const overlays = buildStaggeredCharOverlays(
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 1,
        duration_sec: 3,
        params: {
          content: '我爱你',
          fontSize: 8,
          fontFamily: 'Noto Sans SC',
          textAlign: 'center',
        },
      },
      1080,
      1920,
      { stagger_sec: 0.3, in_type: 'pop' }
    )
    expect(overlays).toHaveLength(3)
    expect(overlays.map((item) => item.params.content)).toEqual(['我', '爱', '你'])
    expect(overlays[0]?.start_sec).toBe(1)
    expect(overlays[1]?.start_sec).toBeCloseTo(1.3)
    expect(overlays[2]?.start_sec).toBeCloseTo(1.6)
    expect(overlays[0]?.params['animation.in.type']).toBe('pop')
  })

  it('builds vertical column with shared center_x and increasing normY', () => {
    const overlays = buildStaggeredCharOverlays(
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 3,
        params: { content: '我爱你', fontSize: 8, fontFamily: 'Noto Sans SC' },
      },
      1080,
      1920,
      { layout: 'vertical', center_x: 0.5, center_y: 0.5, in_type: 'fade' }
    )
    expect(overlays).toHaveLength(3)
    const xs = overlays.map((item) => item.params['transform.positionX'])
    const ys = overlays.map((item) => item.params['transform.positionY'])
    expect(new Set(xs).size).toBe(1)
    expect(ys[0]).toBeLessThan(ys[1]!)
    expect(ys[1]).toBeLessThan(ys[2]!)
    expect(overlays[0]?.params['animation.in.type']).toBe('fade')
  })

  it('returns empty for blank content', () => {
    const overlays = buildStaggeredCharOverlays(
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 3,
        params: { content: '   ' },
      },
      1080,
      1920
    )
    expect(overlays).toHaveLength(0)
  })
})
