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
