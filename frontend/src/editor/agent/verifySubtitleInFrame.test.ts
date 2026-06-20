import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import { resolveActiveOverlaysAtTime, resolveVerifySubtitleCapture } from './verifySubtitleCaptureResolve'

function makeSession(overlays: EditSession['overlay_elements']): EditSession {
  return {
    id: 's1',
    name: 'test',
    sequence: [],
    overlay_elements: overlays,
    export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
    audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
  } as EditSession
}

describe('verifySubtitleInFrame', () => {
  it('resolves capture time from overlay start', () => {
    const session = makeSession([
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 2,
        duration_sec: 3,
        params: { content: '我爱你' },
      },
    ])
    const resolved = resolveVerifySubtitleCapture({
      session,
      args: { overlay_id: 'o1' },
      selectedOverlayId: null,
      playheadSec: 0,
    })
    expect(resolved.overlayId).toBe('o1')
    expect(resolved.timeSec).toBeCloseTo(2.2)
  })

  it('lists overlays active at capture time', () => {
    const session = makeSession([
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 1,
        duration_sec: 2,
        params: { content: '我' },
      },
      {
        id: 'o2',
        type: 'text',
        hidden: false,
        start_sec: 1.3,
        duration_sec: 2,
        params: { content: '爱' },
      },
    ])
    const hints = resolveActiveOverlaysAtTime(session, 1.5)
    expect(hints.map((item) => item.id)).toEqual(['o1', 'o2'])
  })
})
