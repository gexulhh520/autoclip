import { describe, expect, it } from 'vitest'
import {
  collectCaptionTextFromOverlays,
  listBlockTextOverlays,
} from './blockCaptionUtils'

describe('blockCaptionUtils', () => {
  it('lists overlays overlapping block window including staggered chars', () => {
    const session = {
      overlay_elements: [
        { id: 'a', type: 'text', hidden: false, start_sec: 5, duration_sec: 3, params: { content: '春' } },
        { id: 'b', type: 'text', hidden: false, start_sec: 5.28, duration_sec: 3, params: { content: '风' } },
        { id: 'c', type: 'text', hidden: false, start_sec: 20, duration_sec: 3, params: { content: '其他' } },
      ],
    } as import('../../types/editSession').EditSession

    const overlays = listBlockTextOverlays(session, 5, 3)
    expect(overlays.map((el) => el.id)).toEqual(['a', 'b'])
  })

  it('collects vertical single-char layers top to bottom', () => {
    const overlays = [
      {
        id: '1',
        type: 'text' as const,
        hidden: false,
        start_sec: 5,
        duration_sec: 3,
        params: { content: '风', 'transform.positionX': 540, 'transform.positionY': 600 },
      },
      {
        id: '2',
        type: 'text' as const,
        hidden: false,
        start_sec: 5.28,
        duration_sec: 3,
        params: { content: '春', 'transform.positionX': 540, 'transform.positionY': 400 },
      },
    ]
    const text = collectCaptionTextFromOverlays(overlays, 1080, 1920)
    expect(text).toBe('春风')
  })
})
