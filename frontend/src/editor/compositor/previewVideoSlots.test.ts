import { describe, expect, it } from 'vitest'
import {
  assignStablePreviewVideoSlots,
  blockIdForPreviewSlot,
} from './previewVideoSlots'

describe('assignStablePreviewVideoSlots', () => {
  it('keeps incoming block on the same slot after transition ends', () => {
    const outgoing = 'block-a'
    const incoming = 'block-b'

    const during = assignStablePreviewVideoSlots([outgoing, incoming], new Map())
    expect(during.get(outgoing)).toBe('a')
    expect(during.get(incoming)).toBe('b')

    const after = assignStablePreviewVideoSlots([incoming], during)
    expect(after.get(incoming)).toBe('b')
    expect(blockIdForPreviewSlot(after, 'b')).toBe(incoming)
    expect(blockIdForPreviewSlot(after, 'a')).toBeNull()
  })
})
