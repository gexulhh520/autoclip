import { describe, expect, it } from 'vitest'
import { blockAlreadyHasCaption } from './addCaptionsForBlocks'

describe('addCaptionsForBlocks', () => {
  it('detects existing caption at block start', () => {
    const session = {
      overlay_elements: [
        {
          id: 'o1',
          type: 'text',
          hidden: false,
          start_sec: 5,
          duration_sec: 3,
          params: { content: '我很好' },
        },
      ],
    } as import('../../types/editSession').EditSession
    expect(blockAlreadyHasCaption(session, 5, '我很好')).toBe(true)
    expect(blockAlreadyHasCaption(session, 5, '别的')).toBe(false)
    expect(blockAlreadyHasCaption(session, 10, '我很好')).toBe(false)
  })
})

describe('pickBlockDraftCaption', () => {
  it('rejects hash-like titles', async () => {
    const { isUsableCaptionDraft, pickBlockDraftCaption } = await import('./pickBlockDraftCaption')
    expect(isUsableCaptionDraft('73d146e43444e8baaeb55052379efd1e')).toBe(false)
    const session = {
      sequence: [
        {
          id: 'b1',
          title: '73d146e43444e8baaeb55052379efd1e',
          trim: { in_sec: 0, out_sec: 3 },
        },
      ],
    } as import('../../types/editSession').EditSession
    expect(pickBlockDraftCaption(session, 'b1')).toBe('')
  })
})
