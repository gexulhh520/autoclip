import { describe, expect, it } from 'vitest'
import { ensurePreviewVideoFrameCache } from './previewVideoFrameCache'

describe('previewVideoFrameCache', () => {
  it('ensurePreviewVideoFrameCache creates canvas once', () => {
    const created = ensurePreviewVideoFrameCache(null)
    const reused = ensurePreviewVideoFrameCache(created)
    expect(reused).toBe(created)
    expect(created.tagName).toBe('CANVAS')
  })
})
