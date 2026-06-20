import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import { buildSplitTextOverlaysBatchResult } from './splitTextOverlaysByChar'

describe('splitTextOverlaysByChar', () => {
  it('splits multiple overlays sequentially', () => {
    const session: EditSession = {
      id: 's1',
      name: 'test',
      export_settings: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
      sequence: [],
      overlay_elements: [
        {
          id: 'o1',
          type: 'text',
          hidden: false,
          start_sec: 0,
          duration_sec: 3,
          params: { content: '你好' },
        },
        {
          id: 'o2',
          type: 'text',
          hidden: false,
          start_sec: 1,
          duration_sec: 3,
          params: { content: '我' },
        },
      ],
    }

    const created: Record<string, string[]> = { o1: ['c1', 'c2'] }
    const batch = buildSplitTextOverlaysBatchResult(
      () => session,
      ['o1', 'o2', 'missing'],
      (overlayId) => created[overlayId] ?? []
    )

    expect(batch.succeeded).toBe(1)
    expect(batch.skipped).toBe(1)
    expect(batch.failed).toBe(1)
  })
})
