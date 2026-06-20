import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  buildStaggeredCharOverlays,
  listSplittableTextOverlayIds,
  resolveBatchSplitPlacement,
  resolveSplitTextOverlayId,
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

  it('returns null for invalid explicit overlay id', () => {
    const session = {
      overlay_elements: [{ id: 'real-id', type: 'text', params: { content: '我爱你' } }],
    } as import('../../types/editSession').EditSession
    expect(resolveSplitTextOverlayId(session, 'fake-id', null)).toBeNull()
    expect(resolveSplitTextOverlayId(session, 'real-id', null)).toBe('real-id')
  })

  it('lists splittable overlay ids', () => {
    const session = {
      overlay_elements: [
        { id: 'a', type: 'text', params: { content: '我' } },
        { id: 'b', type: 'text', params: { content: '我爱你' } },
      ],
    } as import('../../types/editSession').EditSession
    expect(listSplittableTextOverlayIds(session)).toEqual(['b'])
  })

  it('fans out batch placement when overlays share the same center', () => {
    const session = {
      overlay_elements: [
        {
          id: 'o1',
          type: 'text',
          params: { content: '你好', 'transform.positionX': 0, 'transform.positionY': 0 },
        },
        {
          id: 'o2',
          type: 'text',
          params: { content: '世界', 'transform.positionX': 0, 'transform.positionY': 0 },
        },
      ],
    } as import('../../types/editSession').EditSession
    const placement = resolveBatchSplitPlacement(session, ['o1', 'o2'], 1080, 1920)
    const p1 = placement.get('o1')
    const p2 = placement.get('o2')
    expect(p1?.center_x).not.toBeCloseTo(p2?.center_x ?? 0, 2)
  })
})
