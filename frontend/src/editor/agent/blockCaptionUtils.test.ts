import { describe, expect, it } from 'vitest'
import { writeParam } from '../opencut-text/params'
import { TIMELINE_BLOCK_ID_PARAM, TIMELINE_BLOCK_OFFSET_PARAM } from '../timeline/timelineBlockLink'
import {
  collectCaptionTextFromOverlays,
  listBlockTextOverlays,
  listOverlaysForBlock,
} from './blockCaptionUtils'

describe('blockCaptionUtils', () => {
  it('lists overlays by block link first', () => {
    const session = {
      overlay_elements: [
        {
          id: 'a',
          type: 'text',
          hidden: false,
          start_sec: 99,
          duration_sec: 3,
          params: writeParam(
            writeParam({ content: '春' }, TIMELINE_BLOCK_ID_PARAM, 'b1'),
            TIMELINE_BLOCK_OFFSET_PARAM,
            0
          ),
        },
        {
          id: 'b',
          type: 'text',
          hidden: false,
          start_sec: 5.28,
          duration_sec: 3,
          params: { content: '风' },
        },
      ],
    } as import('../../types/editSession').EditSession

    const overlays = listOverlaysForBlock(session, 'b1', 5, 8)
    expect(overlays.map((el) => el.id)).toEqual(['a'])
  })

  it('lists overlays by start_sec within block window', () => {
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
